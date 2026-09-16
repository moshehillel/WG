import { describe, expect, it } from 'vitest';
import { MockHhaClient } from '@white-glove/hha-client';
import { InMemoryIdempotencyStore } from './idempotency.js';
import { InMemoryServiceMappingStore } from './service-mapping.js';
import { processOpenedCases } from './process-opened.js';

const baseOpen = {
  firstName: 'Pat',
  lastName: 'Two',
  programType: 'Extended Home Care Therapy',
  dateOfBirth: '01/01/2020',
  address1: '1 Main St',
  city: 'Brooklyn',
  state: 'NY',
  zipCode: '11201',
  mandateFrequency: 'Weekly',
  mandateTimes: '2',
} as const;

describe('processOpenedCases', () => {
  it('creates patient/contract/auth, stores mapping, and skips EI', async () => {
    const hha = new MockHhaClient();
    const mappingStore = new InMemoryServiceMappingStore();
    const result = await processOpenedCases({
      runId: 'run1',
      hha,
      store: new InMemoryIdempotencyStore(),
      mappingStore,
      rows: [
        {
          caseId: 'ei1',
          firstName: 'Kid',
          lastName: 'One',
          isEarlyIntervention: true,
        },
        {
          ...baseOpen,
          caseId: 'c2',
          serviceCode: 'OT CHHA EXTENDED',
          authorizationNumber: 'A1',
          startDate: '07/01/2026',
        },
      ],
    });
    expect(result.succeeded).toBe(1);
    expect(result.skipped).toBe(1);
    expect(hha.calls.filter((c) => c === 'upsertPatient')).toHaveLength(1);
    expect(hha.calls).toContain('upsertContract');
    expect(hha.calls).toContain('upsertAuthorization');
    const mapping = await mappingStore.get('c2', 'OT CHHA EXTENDED', '07/01/2026');
    expect(mapping?.caseId).toBe('c2');
    expect(mapping?.placementId).toBeTruthy();
  });

  it('opens Camden once and skips historical same-code Gluck periods', async () => {
    const hha = new MockHhaClient();
    const begins = ['01/15/2024', '06/01/2025', '12/01/2025'];
    const result = await processOpenedCases({
      runId: 'run-camden',
      reportKind: 'opened_cases',
      hha,
      store: new InMemoryIdempotencyStore(),
      rows: begins.map((startDate, i) => ({
        ...baseOpen,
        caseId: '102661',
        firstName: 'Camden',
        lastName: 'Asare',
        serviceCode: 'PT CHHA',
        authorizationNumber: `AUTH-${i}`,
        startDate,
        intakeDate: '09/04/2026',
        sourceReport: 'opened_cases' as const,
      })),
    });
    expect(result.succeeded).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.exceptions.filter((e) => e.details?.triageReason === 'gluck_historical_service_line')).toHaveLength(
      2,
    );
    expect(hha.calls.filter((c) => c === 'upsertPatient')).toHaveLength(1);
    expect(hha.calls.filter((c) => c === 'upsertContract')).toHaveLength(1);
  });

  it('processes a second intake-aligned Gluck service as new_services after primary open', async () => {
    const hha = new MockHhaClient();
    const result = await processOpenedCases({
      runId: 'run-two-svc',
      reportKind: 'opened_cases',
      hha,
      store: new InMemoryIdempotencyStore(),
      rows: [
        {
          ...baseOpen,
          programType: 'Garden City UFSD Therapy',
          caseId: 'c9',
          serviceCode: 'OT CHHA',
          authorizationNumber: 'A-OT',
          startDate: '09/04/2026',
          intakeDate: '09/04/2026',
          sourceReport: 'opened_cases',
        },
        {
          ...baseOpen,
          programType: 'Garden City UFSD Therapy',
          caseId: 'c9',
          serviceCode: 'PT CHHA',
          authorizationNumber: 'A-PT',
          startDate: '09/05/2026',
          intakeDate: '09/04/2026',
          sourceReport: 'opened_cases',
        },
      ],
    });
    expect(result.succeeded).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.exceptions.some((e) => e.reportKind === 'new_services')).toBe(false);
    expect(hha.calls.filter((c) => c === 'upsertPatient')).toHaveLength(2);
    expect(hha.calls.filter((c) => c === 'upsertContract')).toHaveLength(2);
  });

  it('attaches resolved ServiceCodeID and mapped HHA name on auth rejection', async () => {
    const hha = new MockHhaClient();
    hha.upsertAuthorization = async () => {
      throw new Error(
        'CreatePatientAuthorization failed: Invalid "ServiceCodeID" (ErrorID=-74) (ServiceCodeID=alias:OT; ProviderSoft="OT HC Eval").',
      );
    };
    const result = await processOpenedCases({
      runId: 'run-sc-reject',
      reportKind: 'opened_cases',
      hha,
      store: new InMemoryIdempotencyStore(),
      rows: [
        {
          ...baseOpen,
          programType: 'Americare Certified',
          caseId: '166448',
          serviceCode: 'OT HC Eval',
          authorizationNumber: 'A-OT-EVAL',
          startDate: '09/01/2026',
          sourceReport: 'opened_cases',
        },
      ],
    });
    expect(result.failed).toBe(1);
    const ex = result.exceptions[0]!;
    expect(ex.code).toBe('hha_api_error');
    expect(ex.details?.serviceCode).toBe('OT HC Eval');
    expect(ex.details?.hhaServiceName).toBe('OT');
    expect(String(ex.details?.serviceCodeId)).toMatch(/OT/);
  });

  it('uses Extended Mandate when Basic frequency is blank and times are 0', async () => {
    const hha = new MockHhaClient();
    // new_services requires the child to already exist in HHA.
    await hha.upsertPatient({
      caseId: 'NYS000000277',
      firstName: 'TIDEMON',
      lastName: 'DOUGLAS',
    });
    const authCalls: Array<{ period?: string; maximum?: number }> = [];
    const original = hha.upsertAuthorization.bind(hha);
    hha.upsertAuthorization = async (auth) => {
      authCalls.push({ period: auth.period, maximum: auth.maximum });
      return original(auth);
    };

    // no_evv program so this test isolates auth mandate fallback (not EVV visit).
    const result = await processOpenedCases({
      runId: 'run-ext-mandate',
      reportKind: 'new_services',
      hha,
      store: new InMemoryIdempotencyStore(),
      rows: [
        {
          ...baseOpen,
          caseId: 'NYS000000277',
          firstName: 'TIDEMON',
          lastName: 'DOUGLAS',
          programType: 'Herricks UFSD Therapy',
          serviceCode: 'PT CHHA',
          mandateFrequency: '',
          mandateTimes: '0',
          extendedMandateFrequency: 'Authorization',
          extendedMandateTimes: '1',
          authorizationNumber: 'approved',
          startDate: '09/01/2026',
          sourceReport: 'new_services',
        },
      ],
    });

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(authCalls).toEqual([{ period: 'Entire Period', maximum: 1 }]);
  });

  it('does not retry a successful new_services row on a later runId', async () => {
    const store = new InMemoryIdempotencyStore();
    // no_evv program: durable skip should not depend on EVV placeholder success.
    const row = {
      ...baseOpen,
      caseId: 'NYS000001701',
      firstName: 'Sofia',
      lastName: 'Kazani',
      programType: 'Herricks UFSD Therapy',
      serviceCode: 'PT CHHA',
      mandateFrequency: '',
      mandateTimes: '2',
      extendedMandateFrequency: 'Weekly',
      extendedMandateTimes: '2',
      authorizationNumber: 'approved',
      startDate: '09/14/2026',
      sourceReport: 'new_services' as const,
    };

    const firstHha = new MockHhaClient();
    await firstHha.upsertPatient({
      caseId: row.caseId,
      firstName: row.firstName,
      lastName: row.lastName,
    });
    const first = await processOpenedCases({
      runId: 'night-1',
      reportKind: 'new_services',
      hha: firstHha,
      store,
      rows: [row],
    });
    expect(first.succeeded).toBe(1);
    expect(first.skipped).toBe(0);

    const secondHha = new MockHhaClient();
    await secondHha.upsertPatient({
      caseId: row.caseId,
      firstName: row.firstName,
      lastName: row.lastName,
    });
    const second = await processOpenedCases({
      runId: 'night-2',
      reportKind: 'new_services',
      hha: secondHha,
      store,
      rows: [row],
    });
    expect(second.succeeded).toBe(0);
    expect(second.skipped).toBe(1);
    expect(secondHha.calls.filter((c) => c === 'upsertAuthorization')).toHaveLength(0);
  });
});
