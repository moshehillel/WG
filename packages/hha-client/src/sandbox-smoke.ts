#!/usr/bin/env node
/**
 * Sandbox smoke tests for HHAeXchange Enterprise SOAP API.
 * Requires HHA_APP_NAME, HHA_APP_SECRET, HHA_APP_KEY (and optional HHA_BASE_URL).
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HhaSoapClient } from './soap-client.js';

const DEFAULT_SANDBOX =
  'https://sandbox1.hhaexchange.com/Integration/ENT/V1.8/ws.asmx';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env ${name}`);
  return value;
}

async function main() {
  const client = new HhaSoapClient({
    baseUrl: process.env.HHA_BASE_URL ?? DEFAULT_SANDBOX,
    auth: {
      appName: required('HHA_APP_NAME'),
      appSecret: required('HHA_APP_SECRET'),
      appKey: required('HHA_APP_KEY'),
    },
  });

  const results: Record<string, unknown> = {
    testedAt: new Date().toISOString(),
    endpoint: process.env.HHA_BASE_URL ?? DEFAULT_SANDBOX,
  };

  console.log('1) GetOffices…');
  const offices = await client.getOffices();
  results.getOffices = summarize(offices);
  printSummary('GetOffices', offices);

  console.log('2) GetContracts…');
  const contracts = await client.getContracts();
  results.getContracts = summarize(contracts);
  printSummary('GetContracts', contracts);

  console.log('3) GetDisciplines…');
  const disciplines = await client.getDisciplines();
  results.getDisciplines = summarize(disciplines);
  printSummary('GetDisciplines', disciplines);

  const contractId = firstNestedId(contracts.raw, [
    ['Contracts', 'Contract'],
    ['Contract'],
  ]);
  if (contractId) {
    console.log(`4) GetContractServiceCode(${contractId})…`);
    const codes = await client.getContractServiceCode(contractId);
    results.getContractServiceCode = summarize(codes);
    printSummary('GetContractServiceCode', codes);
  } else {
    results.getContractServiceCode = { skipped: true, reason: 'no contract id' };
    console.log('4) GetContractServiceCode skipped (no contract id)');
  }

  console.log('5) SearchPatients (Status=Active)…');
  const patients = await client.searchPatients({ status: 'Active' });
  results.searchPatients = summarize(patients);
  printSummary('SearchPatients', patients);

  const patientIds = collectPatientIds(patients.raw);
  results.samplePatientIds = patientIds.slice(0, 5);

  if (patientIds[0]) {
    const pid = patientIds[0];
    console.log(`6) GetPatientDemographics(${pid})…`);
    const demo = await client.getPatientDemographics(pid);
    results.getPatientDemographics = summarize(demo);
    printSummary('GetPatientDemographics', demo);

    console.log(`7) GetPatientContracts(${pid})…`);
    const pc = await client.getPatientContracts(pid);
    results.getPatientContracts = summarize(pc);
    printSummary('GetPatientContracts', pc);

    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 30);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);
    console.log(`8) SearchVisits(patient=${pid}, ${startDate}..${endDate})…`);
    const visits = await client.searchVisits({ patientId: pid, startDate, endDate });
    results.searchVisits = summarize(visits);
    printSummary('SearchVisits', visits);

    const visitId = firstNestedId(visits.raw, [['Visits', 'Visit'], ['Visit']]);
    if (visitId) {
      console.log(`9) GetVisitInfoV2(${visitId})…`);
      const visit = await client.getVisitInfoV2(visitId);
      results.getVisitInfoV2 = summarize(visit);
      printSummary('GetVisitInfoV2', visit);
    } else {
      results.getVisitInfoV2 = { skipped: true, reason: 'no visit id in range' };
      console.log('9) GetVisitInfoV2 skipped (no visit id)');
    }
  } else {
    console.log('6–9 skipped (no patients returned)');
    results.getPatientDemographics = { skipped: true };
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const outDir = path.join(repoRoot, 'docs');
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, 'hha-sandbox-smoke-results.json');
  await writeFile(outFile, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nWrote ${outFile}`);

  const critical = ['getOffices', 'getContracts', 'searchPatients'] as const;
  const failed = critical.filter((k) => !(results[k] as { ok?: boolean } | undefined)?.ok);
  if (failed.length) {
    console.error(`\nCRITICAL FAILURES: ${failed.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nAuth + core reads succeeded against sandbox.');
  }
}

function printSummary(
  _name: string,
  result: { ok: boolean; status?: string; errorId?: string; errorMessage?: string },
) {
  console.log(
    `   → ok=${result.ok} status=${result.status ?? '-'} errorId=${result.errorId ?? '-'} msg=${result.errorMessage ?? '-'}`,
  );
}

function summarize(result: {
  ok: boolean;
  status?: string;
  errorId?: string;
  errorMessage?: string;
  raw: unknown;
}) {
  return {
    ok: result.ok,
    status: result.status,
    errorId: result.errorId,
    errorMessage: result.errorMessage,
    rawPreview: truncate(result.raw, 3000),
  };
}

function truncate(value: unknown, max: number): unknown {
  const json = JSON.stringify(value);
  if (!json) return value;
  if (json.length <= max) return value;
  return `${json.slice(0, max)}…`;
}

function collectPatientIds(raw: unknown): number[] {
  if (!raw || typeof raw !== 'object') return [];
  const patients = (raw as { Patients?: { PatientID?: unknown } }).Patients;
  if (!patients) return [];
  const ids = patients.PatientID;
  if (Array.isArray(ids)) return ids.map(Number).filter((n) => !Number.isNaN(n));
  if (ids !== undefined) return [Number(ids)].filter((n) => !Number.isNaN(n));
  return [];
}

function firstNestedId(raw: unknown, paths: string[][]): number | undefined {
  for (const parts of paths) {
    let cur: unknown = raw;
    for (const part of parts) {
      if (!cur || typeof cur !== 'object') {
        cur = undefined;
        break;
      }
      cur = (cur as Record<string, unknown>)[part];
    }
    if (Array.isArray(cur)) cur = cur[0];
    if (cur && typeof cur === 'object') {
      const obj = cur as Record<string, unknown>;
      cur = obj.ID ?? obj.ContractID ?? obj.VisitID ?? obj.PatientID;
    }
    const n = Number(cur);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
