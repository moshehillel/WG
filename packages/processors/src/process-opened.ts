import type { HhaClient } from '@white-glove/hha-client';
import { AmbiguousPatientNameError } from '@white-glove/hha-client';
import type { OpenedCaseRow, PipelineException, ProcessorResult } from '@white-glove/shared';
import {
  buildHhaRowException,
  buildRowException,
} from '@white-glove/shared';
import type { IdempotencyStore } from './idempotency.js';
import { rowKey } from './idempotency.js';
import { billingGuardMessage, validateOpenCaseBilling } from './billing-guards.js';
import type { ServiceMappingStore } from './service-mapping.js';
import { HHA_NAME_MATCH_HINT, previewOpenedCaseWithHha } from './preview-scan.js';
import { openedCaseToHhaPatient } from './opened-to-hha-patient.js';
import { filterOpenedCases } from './rules.js';

function missingFieldMessage(reportKind: string, rowId: string | undefined, fields: string[]): string {
  const id = rowId ? `row=${rowId}` : 'row=(unknown)';
  return `[${reportKind}] ${id} missing required field(s): ${fields.join(', ')}`;
}

function openedRowId(row: OpenedCaseRow): string {
  const service = row.serviceCode?.trim() || 'unknown-service';
  const start = row.startDate?.trim() || 'unknown-start';
  return `${row.caseId}#${service}#${start}`;
}

export async function processOpenedCases(options: {
  runId: string;
  rows: OpenedCaseRow[];
  hha: HhaClient;
  store: IdempotencyStore;
  mappingStore?: ServiceMappingStore;
  dryRun?: boolean;
}): Promise<ProcessorResult> {
  const { runId, hha, store, mappingStore, dryRun } = options;
  const { kept, skippedEi } = filterOpenedCases(options.rows);
  const exceptions: PipelineException[] = skippedEi.map((row) => ({
    code: 'skipped_by_rule',
    message: `[opened_cases] row=${row.caseId ?? '(unknown)'} skipped: Early Intervention case not sent to HHA`,
    reportKind: 'opened_cases',
    rowId: row.caseId,
  }));

  let succeeded = 0;
  let skipped = skippedEi.length;
  let failed = 0;

  for (const row of kept) {
    const missing: string[] = [];
    if (!row.caseId) missing.push('caseId');
    if (!row.firstName) missing.push('firstName');
    if (!row.lastName) missing.push('lastName');
    if (missing.length) {
      failed += 1;
      exceptions.push(
        buildRowException({
          code: 'parse_error',
          message: missingFieldMessage('opened_cases', row.caseId, missing),
          reportKind: 'opened_cases',
          rowId: row.caseId || undefined,
          details: { missing, firstName: row.firstName, lastName: row.lastName },
        }),
      );
      continue;
    }

    const billingMissing = validateOpenCaseBilling(row);
    if (billingMissing.length) {
      failed += 1;
      exceptions.push(
        buildRowException({
          code: 'parse_error',
          message: billingGuardMessage('opened_cases', row.caseId, billingMissing),
          reportKind: 'opened_cases',
          rowId: row.caseId,
          details: { missing: billingMissing },
        }),
      );
      continue;
    }

    const { pk, sk } = rowKey('opened_cases', openedRowId(row));
    if (!dryRun && (await store.alreadyProcessed(pk, `${runId}#${sk}`))) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      const previewIssues = await previewOpenedCaseWithHha(row, hha);
      if (previewIssues.length) {
        failed += 1;
        exceptions.push(...previewIssues);
      } else {
        succeeded += 1;
      }
      continue;
    }

    let step = 'upsertPatient';
    try {
      const contractNum =
        (row.contractId ? Number(row.contractId) : undefined) ??
        (await hha.resolveContractId(row.programType));
      const contractId = contractNum ? String(contractNum) : undefined;
      if (!contractId) {
        failed += 1;
        exceptions.push(
          buildRowException({
            code: 'other',
            message: `[opened_cases] row=${row.caseId} no HHA ContractID for program type "${row.programType ?? '(missing)'}" — ${HHA_NAME_MATCH_HINT}`,
            reportKind: 'opened_cases',
            rowId: row.caseId,
            details: { programType: row.programType },
          }),
        );
        continue;
      }

      step = 'resolveServiceCodeId';
      const serviceCodeId = await hha.resolveServiceCodeId(row.serviceCode, contractNum);
      if (!serviceCodeId) {
        failed += 1;
        exceptions.push(
          buildRowException({
            code: 'unknown_service_code',
            message: `[opened_cases] row=${row.caseId} service type "${row.serviceCode}" not found in HHA billing codes — ${HHA_NAME_MATCH_HINT}`,
            reportKind: 'opened_cases',
            rowId: row.caseId,
            details: { serviceCode: row.serviceCode, contractId },
          }),
        );
        continue;
      }

      step = 'upsertPatient';
      const patient = await hha.upsertPatient(openedCaseToHhaPatient(row));
      step = 'upsertContract';
      const contract = await hha.upsertContract({
        patientId: patient.id,
        contractExternalId: contractId,
        serviceCode: row.serviceCode,
        startDate: row.startDate,
        endDate: row.endDate,
      });
      step = 'upsertAuthorization';
      const authorization = await hha.upsertAuthorization({
        patientId: patient.id,
        authorizationNumber: row.authorizationNumber,
        serviceCode: row.serviceCode,
        contractId,
        startDate: row.startDate,
        endDate: row.endDate,
      });
      if (mappingStore && row.startDate?.trim()) {
        await mappingStore.put({
          caseId: row.caseId,
          serviceCode: row.serviceCode,
          startDate: row.startDate,
          patientId: patient.id,
          placementId: contract.id,
          authorizationId: authorization.id,
          contractId,
          updatedAt: new Date().toISOString(),
        });
      }
      await store.markProcessed(pk, `${runId}#${sk}`, { caseId: row.caseId });
      succeeded += 1;
    } catch (err) {
      failed += 1;
      if (err instanceof AmbiguousPatientNameError) {
        exceptions.push(
          buildRowException({
            code: 'unmatched_patient',
            message: `[opened_cases] row=${row.caseId}: ${err.message}`,
            reportKind: 'opened_cases',
            rowId: row.caseId,
            details: {
              step,
              firstName: err.firstName,
              lastName: err.lastName,
              hhaNameMatches: err.matchCount,
            },
          }),
        );
        continue;
      }
      exceptions.push(
        buildHhaRowException({
          reportKind: 'opened_cases',
          rowId: row.caseId,
          step,
          err,
          extraDetails: {
            patientExternalId: row.patientExternalId,
            serviceCode: row.serviceCode,
          },
        }),
      );
    }
  }

  return {
    runId,
    reportKind: 'opened_cases',
    processed: options.rows.length,
    succeeded,
    skipped,
    failed,
    exceptions,
  };
}
