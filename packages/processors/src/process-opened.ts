import type { HhaClient } from '@white-glove/hha-client';
import { AmbiguousPatientNameError } from '@white-glove/hha-client';
import type { OpenedCaseRow, PipelineException, ProcessorResult, ProcessorSuccessRow } from '@white-glove/shared';
import {
  buildHhaRowException,
  buildRowException,
  lookupServiceCodeAlias,
  mapMandateFrequencyToPeriod,
  parseAuthMaximum,
  partyDetailsFromRow,
} from '@white-glove/shared';
import type { IdempotencyStore } from './idempotency.js';
import { rowKey } from './idempotency.js';
import { billingGuardMessage, validateOpenCaseBilling } from './billing-guards.js';
import { enrichOpenedRowFromHha } from './enrich-opened-from-hha.js';
import type { ServiceMappingStore } from './service-mapping.js';
import { HHA_NAME_MATCH_HINT, previewOpenedCaseWithHha } from './preview-scan.js';
import { openedCaseToHhaPatient } from './opened-to-hha-patient.js';
import { partitionGluckOpenRows } from './gluck-open-partition.js';
import { filterOpenedCases } from './rules.js';
import {
  NEW_SERVICE_PROVIDER_COLUMN,
  scheduleEvvNewServiceVisit,
  shouldScheduleEvvVisitForNewService,
} from './schedule-evv-new-service-visit.js';
import { consumeTimeBudgetStop } from './time-budget.js';

export type OpenedReportKind = 'opened_cases' | 'new_services';

function resolveOpenedReportKind(
  reportKind: OpenedReportKind | undefined,
  rows: OpenedCaseRow[],
): OpenedReportKind {
  if (reportKind) return reportKind;
  const fromRow = rows.find((r) => r.sourceReport)?.sourceReport;
  return fromRow === 'new_services' ? 'new_services' : 'opened_cases';
}

function missingFieldMessage(reportKind: string, rowId: string | undefined, fields: string[]): string {
  const id = rowId ? `row=${rowId}` : 'row=(unknown)';
  const list = fields.length ? fields.join(', ') : '(unknown)';
  return `[${reportKind}] ${id} FAILED — missing required field(s): ${list}. No HHA write attempted.`;
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
  /** Gluck open vs new service — drives exception/email labels. */
  reportKind?: OpenedReportKind;
  /** Return a partial result before Lambda hard-timeout. */
  shouldYield?: () => boolean;
  /** Internal: skip Gluck multi-line partition (used for new_services follow-up). */
  skipGluckPartition?: boolean;
}): Promise<ProcessorResult> {
  const { runId, hha, store, mappingStore, dryRun, shouldYield } = options;
  const reportKind = resolveOpenedReportKind(options.reportKind, options.rows);
  // Stamp sourceReport from reportKind so enrich/billing labels work even if the
  // S3 artifact omitted it (OpenedFn loads gluck vs new_services separately).
  const rowsWithSource = options.rows.map((r) =>
    r.sourceReport ? r : { ...r, sourceReport: reportKind },
  );
  const { kept: afterEi, skippedEi } = filterOpenedCases(rowsWithSource);
  const exceptions: PipelineException[] = skippedEi.map((row) =>
    buildRowException({
      code: 'skipped_by_rule',
      message: `[${reportKind}] row=${row.caseId ?? '(unknown)'} skipped: Early Intervention case not sent to HHA`,
      reportKind,
      rowId: row.caseId,
      details: { triageReason: 'early_intervention', ...partyDetailsFromRow(row) },
    }),
  );
  const successes: ProcessorSuccessRow[] = [];

  let succeeded = 0;
  let skipped = skippedEi.length;
  let failed = 0;

  // Gluck Service Report = one row per service period. Open the child once; route
  // extra intake-aligned lines to new_services; skip historical periods.
  let kept = afterEi;
  let followUpNewServices: OpenedCaseRow[] = [];
  if (reportKind === 'opened_cases' && !options.skipGluckPartition) {
    const part = partitionGluckOpenRows(afterEi);
    kept = part.primaries;
    followUpNewServices = part.asNewServices;
    for (const row of part.skippedHistorical) {
      skipped += 1;
      exceptions.push(
        buildRowException({
          code: 'skipped_by_rule',
          message: `[opened_cases] row=${row.caseId} skipped: additional Gluck service line (${row.serviceCode ?? 'unknown'} begin ${row.startDate ?? 'n/a'}) — open child once; historical periods are not re-opened from Gluck (use new service for new begins)`,
          reportKind: 'opened_cases',
          rowId: row.caseId,
          details: {
            triageReason: 'gluck_historical_service_line',
            serviceCode: row.serviceCode,
            startDate: row.startDate,
            intakeDate: row.intakeDate,
            ...partyDetailsFromRow(row),
          },
        }),
      );
    }
  }

  for (let i = 0; i < kept.length; i++) {
    const budget = consumeTimeBudgetStop(shouldYield, kept.length - i, i, reportKind, exceptions);
    if (budget.stop) {
      failed += budget.extraFailed;
      break;
    }
    const row = kept[i]!;
    const party = partyDetailsFromRow(row);
    if (i === 0 || (i + 1) % 10 === 0) {
      console.info(`[${reportKind}] ${i + 1}/${kept.length} case=${row.caseId ?? '(unknown)'}`);
    }
    const missing: string[] = [];
    if (!row.caseId) missing.push('caseId');
    if (!row.firstName) missing.push('firstName');
    if (!row.lastName) missing.push('lastName');
    if (missing.length) {
      failed += 1;
      exceptions.push(
        buildRowException({
          code: 'missing_field',
          message: missingFieldMessage(reportKind, row.caseId, missing),
          reportKind,
          rowId: row.caseId || undefined,
          details: {
            missing,
            ...party,
            ...(dryRun ? { preview: true } : {}),
          },
        }),
      );
      continue;
    }

    // new_services: HHA lookup first (missing → unmatched). opened_cases: backfill blank
    // address from HHA when patient exists; true new intake keeps ProviderSoft billing guard.
    let enriched: OpenedCaseRow;
    let patientFound: boolean | undefined;
    try {
      const enrichResult = await enrichOpenedRowFromHha(row, hha);
      enriched = enrichResult.row;
      patientFound = enrichResult.patientFound;
    } catch (err) {
      if (err instanceof AmbiguousPatientNameError) {
        failed += 1;
        exceptions.push(
          buildRowException({
            code: 'unmatched_patient',
            message: `[${reportKind}] row=${row.caseId}: ${err.message}`,
            reportKind,
            rowId: row.caseId,
            details: {
              step: 'findPatient',
              firstName: err.firstName,
              lastName: err.lastName,
              hhaNameMatches: err.matchCount,
              ...party,
              ...(dryRun ? { preview: true } : {}),
            },
          }),
        );
        continue;
      }
      throw err;
    }
    const enrichedParty = partyDetailsFromRow(enriched);

    if (reportKind === 'new_services' && patientFound === false) {
      failed += 1;
      const patientName =
        [enriched.firstName, enriched.lastName].filter(Boolean).join(' ') || enriched.caseId;
      exceptions.push(
        buildRowException({
          code: 'unmatched_patient',
          message: `[new_services] row=${enriched.caseId} patient not found in HHA. No HHA write attempted.`,
          reportKind: 'new_services',
          rowId: enriched.caseId,
          details: {
            ...enrichedParty,
            patientName,
            ...(dryRun ? { preview: true } : {}),
          },
        }),
      );
      continue;
    }

    const billingMissing = validateOpenCaseBilling(enriched);
    if (billingMissing.length) {
      failed += 1;
      exceptions.push(
        buildRowException({
          code: 'missing_field',
          message: billingGuardMessage(reportKind, enriched.caseId, billingMissing),
          reportKind,
          rowId: enriched.caseId,
          details: {
            missing: billingMissing,
            ...enrichedParty,
            ...(dryRun ? { preview: true } : {}),
          },
        }),
      );
      continue;
    }

    const { pk, sk } = rowKey(reportKind, openedRowId(enriched));
    // Include runId so historical replays with a new runId re-evaluate rows.
    const idemSk = `${runId}#${sk}`;
    if (!dryRun && (await store.alreadyProcessed(pk, idemSk))) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      const previewIssues = await previewOpenedCaseWithHha(enriched, hha);
      if (previewIssues.length) {
        failed += 1;
        exceptions.push(...previewIssues);
      } else {
        succeeded += 1;
        successes.push({ rowId: enriched.caseId, ...enrichedParty });
      }
      continue;
    }

    let step = 'upsertPatient';
    let serviceCodeId: string | undefined;
    let hhaServiceName: string | undefined;
    try {
      const contractNum =
        (enriched.contractId ? Number(enriched.contractId) : undefined) ??
        (await hha.resolveContractId(enriched.programType));
      const contractId = contractNum ? String(contractNum) : undefined;
      if (!contractId) {
        failed += 1;
        exceptions.push(
          buildRowException({
            code: 'other',
            message: `[${reportKind}] row=${enriched.caseId} no HHA ContractID for program type "${enriched.programType ?? '(missing)'}" — ${HHA_NAME_MATCH_HINT}`,
            reportKind,
            rowId: enriched.caseId,
            details: { programType: enriched.programType, ...enrichedParty },
          }),
        );
        continue;
      }

      step = 'resolveServiceCodeId';
      const alias = lookupServiceCodeAlias(enriched.serviceCode, enriched.programType);
      hhaServiceName = alias?.hhaServiceCodeName;
      serviceCodeId = await hha.resolveServiceCodeId(
        enriched.serviceCode,
        contractNum,
        enriched.programType,
      );
      if (!serviceCodeId) {
        failed += 1;
        const mappedBit =
          hhaServiceName && hhaServiceName !== enriched.serviceCode
            ? ` (mapped HHA "${hhaServiceName}")`
            : '';
        exceptions.push(
          buildRowException({
            code: 'unknown_service_code',
            message: `[${reportKind}] row=${enriched.caseId} service type "${enriched.serviceCode}"${mappedBit} not found in HHA billing codes for this contract — would fail CreatePatientAuthorization (Invalid ServiceCodeID)`,
            reportKind,
            rowId: enriched.caseId,
            details: {
              serviceCode: enriched.serviceCode,
              ...(hhaServiceName ? { hhaServiceName } : {}),
              programType: enriched.programType,
              contractId,
              ...enrichedParty,
            },
          }),
        );
        continue;
      }

      step = 'upsertPatient';
      const patient = await hha.upsertPatient(openedCaseToHhaPatient(enriched));
      step = 'upsertContract';
      const contract = await hha.upsertContract({
        patientId: patient.id,
        contractExternalId: contractId,
        serviceCode: enriched.serviceCode,
        serviceCodeId,
        startDate: enriched.startDate,
        endDate: enriched.endDate,
      });
      step = 'upsertAuthorization';
      const period = mapMandateFrequencyToPeriod(enriched.mandateFrequency);
      const maximum = parseAuthMaximum(enriched.mandateTimes);
      // Period/Maximum must come from this PS row (or exact Authorization Number reuse in HHA).
      // Never copy from a sibling auth.
      if (!period || maximum === undefined) {
        failed += 1;
        exceptions.push(
          buildRowException({
            code: 'missing_field',
            message: `[${reportKind}] row=${enriched.caseId} invalid auth mandate — frequency "${enriched.mandateFrequency ?? ''}" / times "${enriched.mandateTimes ?? ''}"`,
            reportKind,
            rowId: enriched.caseId,
            details: {
              mandateFrequency: enriched.mandateFrequency,
              mandateTimes: enriched.mandateTimes,
              ...enrichedParty,
            },
          }),
        );
        continue;
      }
      const authorization = await hha.upsertAuthorization({
        patientId: patient.id,
        authorizationNumber: enriched.authorizationNumber,
        serviceCode: enriched.serviceCode,
        serviceCodeId,
        programType: enriched.programType,
        contractId,
        startDate: enriched.startDate,
        endDate: enriched.endDate,
        period,
        maximum,
      });
      if (mappingStore && enriched.startDate?.trim()) {
        await mappingStore.put({
          caseId: enriched.caseId,
          serviceCode: enriched.serviceCode!,
          startDate: enriched.startDate!,
          patientId: patient.id,
          placementId: contract.id,
          authorizationId: authorization.id,
          contractId,
          updatedAt: new Date().toISOString(),
        });
      }

      // EVV new_services: placeholder visit so the therapist can mobile-clock.
      if (shouldScheduleEvvVisitForNewService(enriched)) {
        step = 'locateOrScheduleVisit';
        if (!enriched.providerName?.trim()) {
          failed += 1;
          exceptions.push(
            buildRowException({
              code: 'missing_field',
              message: `[new_services] row=${enriched.caseId} EVV placeholder visit needs "${NEW_SERVICE_PROVIDER_COLUMN}" on the new service export (blank or missing column) — auth was written; fix Provider Name and retry`,
              reportKind,
              rowId: enriched.caseId,
              details: {
                missing: [NEW_SERVICE_PROVIDER_COLUMN],
                expectedColumn: NEW_SERVICE_PROVIDER_COLUMN,
                visitSchedule: true,
                ...enrichedParty,
              },
            }),
          );
          continue;
        }
        await scheduleEvvNewServiceVisit({
          row: enriched,
          hha,
          patientId: patient.id,
          contractId,
          serviceCodeId,
        });
      }

      await store.markProcessed(pk, idemSk, { caseId: enriched.caseId, runId });
      succeeded += 1;
      successes.push({ rowId: enriched.caseId, ...enrichedParty });
    } catch (err) {
      failed += 1;
      if (err instanceof AmbiguousPatientNameError) {
        exceptions.push(
          buildRowException({
            code: 'unmatched_patient',
            message: `[${reportKind}] row=${row.caseId}: ${err.message}`,
            reportKind,
            rowId: row.caseId,
            details: {
              step,
              firstName: err.firstName,
              lastName: err.lastName,
              hhaNameMatches: err.matchCount,
              ...enrichedParty,
            },
          }),
        );
        continue;
      }
      exceptions.push(
        buildHhaRowException({
          reportKind,
          rowId: row.caseId,
          step,
          err,
          extraDetails: {
            patientExternalId: row.patientExternalId,
            serviceCode: row.serviceCode,
            ...(serviceCodeId ? { serviceCodeId } : {}),
            ...(hhaServiceName ? { hhaServiceName } : {}),
            programType: enriched.programType,
            ...enrichedParty,
          },
        }),
      );
    }
  }

  const primaryResult: ProcessorResult = {
    runId,
    reportKind,
    processed: options.rows.length,
    succeeded,
    skipped,
    failed,
    exceptions,
    successes: successes.length ? successes : undefined,
    ...(exceptions.some((ex) => ex.details?.timedOut === true) ? { timedOut: true as const } : {}),
  };

  if (!followUpNewServices.length || primaryResult.timedOut) {
    return primaryResult;
  }

  const newServicesResult = await processOpenedCases({
    runId,
    rows: followUpNewServices,
    hha,
    store,
    mappingStore,
    dryRun,
    reportKind: 'new_services',
    shouldYield,
    skipGluckPartition: true,
  });

  // follow-up rows were already counted in primaryResult.processed (original Gluck set).
  return {
    runId,
    reportKind,
    processed: primaryResult.processed,
    succeeded: primaryResult.succeeded + newServicesResult.succeeded,
    skipped: primaryResult.skipped + newServicesResult.skipped,
    failed: primaryResult.failed + newServicesResult.failed,
    exceptions: [...primaryResult.exceptions, ...newServicesResult.exceptions],
    successes:
      primaryResult.successes?.length || newServicesResult.successes?.length
        ? [...(primaryResult.successes ?? []), ...(newServicesResult.successes ?? [])]
        : undefined,
    ...((primaryResult.timedOut || newServicesResult.timedOut) ? { timedOut: true as const } : {}),
  };
}
