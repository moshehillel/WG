import { randomUUID } from 'node:crypto';
import type { HhaClockingDetails, HhaPatient, HhaVisit } from '@white-glove/shared';
import { lookupContractId, lookupServiceCode, lookupServiceCodeAlias } from '@white-glove/shared';
import { stripLeadingZerosFromNumericId } from './create-patient-builder.js';
import { resolvePlacementForService } from './resolve-placement.js';
import { isTrustedHhaPatientId, toFindPatientOptions } from './resolve-patient-id.js';
import type {
  ClosedCaseUpdate,
  DischargeAllPlacementsOptions,
  DischargePlacementOptions,
  DischargeServiceUpdate,
  FindPatientOptions,
  HhaClient,
  PatientPlacementSummary,
  PendingCall,
  UpsertResult,
} from './types.js';

/**
 * In-memory mock used until HHA sandbox + API docs are available.
 */
export class MockHhaClient implements HhaClient {
  readonly patients = new Map<string, HhaPatient & { id: string }>();
  readonly contracts = new Map<string, UpsertResult>();
  readonly authorizations = new Map<string, UpsertResult>();
  readonly visits = new Map<string, HhaVisit & { id: string; approved: boolean }>();
  readonly closedCases = new Map<string, ClosedCaseUpdate>();
  readonly placementsByPatient = new Map<string, PatientPlacementSummary[]>();
  readonly dischargedPlacements = new Set<string>();
  readonly pendingCalls = new Map<string, PendingCall>();
  readonly payCodes = new Map<string, string>([
    ['OT72', 'pay-ot72'],
    ['OT70', 'pay-ot70'],
  ]);
  readonly caregiverByName = new Map<string, string | undefined>();
  readonly calls: string[] = [];

  async findPatient(options: FindPatientOptions): Promise<string | undefined> {
    this.calls.push('findPatient');
    const matchKeys = (keys: Array<string | undefined>): string | undefined => {
      for (const want of keys) {
        if (!want) continue;
        for (const [, patient] of this.patients) {
          if (patient.externalId === want || patient.caseId === want) return patient.id;
        }
        const existing = this.patients.get(want);
        if (existing) return existing.id;
      }
      return undefined;
    };

    const exact = matchKeys([options.externalId, options.caseId]);
    if (exact) return exact;

    const stripped = matchKeys([
      stripLeadingZerosFromNumericId(options.externalId),
      stripLeadingZerosFromNumericId(options.caseId),
    ]);
    if (stripped) return stripped;

    return this.findPatientByExactName(options);
  }

  private findPatientByExactName(
    options: FindPatientOptions,
  ): string | undefined {
    const first = options.firstName?.trim();
    const last = options.lastName?.trim();
    if (!first || !last) return undefined;

    const nameEq = (a?: string, b?: string) =>
      (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
    const dobKey = (d?: string) => {
      if (!d?.trim()) return undefined;
      const m = d.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) return `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
      return d.trim().slice(0, 10);
    };
    const wantDob = dobKey(options.dateOfBirth);

    const collect = (expectFirst: string, expectLast: string) => {
      const hits: Array<{ id: string; dob?: string }> = [];
      for (const [, patient] of this.patients) {
        const asIs = nameEq(patient.firstName, expectFirst) && nameEq(patient.lastName, expectLast);
        const swapped =
          nameEq(patient.firstName, expectLast) && nameEq(patient.lastName, expectFirst);
        if (asIs || swapped) hits.push({ id: patient.id, dob: patient.dateOfBirth });
      }
      return hits;
    };

    let hits = collect(first, last);
    if (hits.length === 0) hits = collect(last, first);

    if (wantDob) {
      const dobHits = hits.filter((h) => dobKey(h.dob) === wantDob);
      if (dobHits.length === 1) return dobHits[0]!.id;
      if (dobHits.length > 1) return undefined;
    }
    if (hits.length === 1) return hits[0]!.id;
    return undefined;
  }

  async getPatientGender(patientId: string): Promise<string | undefined> {
    this.calls.push('getPatientGender');
    const demo = await this.getPatientDemographicsFields(patientId);
    return demo.gender;
  }

  async getPatientDemographicsFields(
    patientId: string,
  ): Promise<import('./types.js').PatientDemoFields> {
    this.calls.push('getPatientDemographicsFields');
    const patient =
      this.patients.get(patientId) ??
      [...this.patients.values()].find((p) => p.id === patientId);
    if (!patient) return {};
    return {
      gender: patient.gender,
      address1: patient.address1,
      city: patient.city,
      state: patient.state,
      zipCode: patient.zipCode,
    };
  }

  async upsertPatient(patient: HhaPatient): Promise<UpsertResult> {
    this.calls.push('upsertPatient');
    const key =
      patient.externalId ??
      patient.caseId ??
      `${patient.lastName}|${patient.firstName}|${patient.dateOfBirth ?? ''}`;
    const existing = this.patients.get(key);
    if (existing) {
      this.patients.set(key, { ...existing, ...patient });
      return { id: existing.id, created: false };
    }
    const id = randomUUID();
    this.patients.set(key, { ...patient, id });
    return { id, created: true };
  }

  async upsertContract(contract: Parameters<HhaClient['upsertContract']>[0]): Promise<UpsertResult> {
    this.calls.push('upsertContract');
    const patientKey = contract.patientId;
    const list = this.placementsByPatient.get(patientKey) ?? [];
    const existing = list.find(
      (p) =>
        !p.dischargeDate &&
        p.contractId === contract.contractExternalId &&
        p.startDate === contract.startDate,
    );
    if (existing) return { id: existing.placementId, created: false };
    const placementId = randomUUID();
    const serviceCodeId = lookupServiceCode(contract.serviceCode)?.hhaCode;
    list.push({
      placementId,
      contractId: contract.contractExternalId,
      serviceCodeId,
      startDate: contract.startDate,
    });
    this.placementsByPatient.set(patientKey, list);
    const legacyKey =
      contract.contractExternalId ?? `${contract.patientId}:${contract.serviceCode ?? ''}`;
    this.contracts.set(legacyKey, { id: placementId, created: true });
    return { id: placementId, created: true };
  }

  async upsertAuthorization(
    auth: Parameters<HhaClient['upsertAuthorization']>[0],
  ): Promise<UpsertResult> {
    this.calls.push('upsertAuthorization');
    const key = auth.authorizationNumber ?? `${auth.patientId}:${auth.serviceCode ?? ''}`;
    const existing = this.authorizations.get(key);
    if (existing) return { id: existing.id, created: false };
    const result = { id: randomUUID(), created: true };
    this.authorizations.set(key, result);
    return result;
  }

  async locateOrScheduleVisit(visit: HhaVisit): Promise<UpsertResult> {
    this.calls.push('locateOrScheduleVisit');
    const key =
      visit.visitExternalId ??
      `${visit.patientId}:${visit.visitDate ?? ''}:${visit.startTime ?? ''}`;
    const existing = this.visits.get(key);
    if (existing) return { id: existing.id, created: false };
    const id = randomUUID();
    this.visits.set(key, { ...visit, id, approved: false });
    return { id, created: true };
  }

  async findPendingCall(options: {
    patientId: string;
    caregiverId?: string;
    visitDate: string;
  }): Promise<PendingCall | undefined> {
    this.calls.push('findPendingCall');
    const key = `${options.patientId}:${options.visitDate}:${options.caregiverId ?? ''}`;
    return this.pendingCalls.get(key);
  }

  async linkClockToVisit(
    visitId: string,
    _options: { callerId: string; startTime?: string; endTime?: string },
  ): Promise<void> {
    this.calls.push('linkClockToVisit');
    for (const [key, visit] of this.visits) {
      if (visit.id === visitId) {
        this.visits.set(key, { ...visit, approved: false });
        return;
      }
    }
  }

  async resolveCaregiverId(providerName: string | undefined): Promise<string | undefined> {
    this.calls.push('resolveCaregiverId');
    if (!providerName?.trim()) return undefined;
    const key = providerName.trim().toUpperCase();
    // Explicit map entry (including undefined) wins — tests can force "not found".
    if (this.caregiverByName.has(key)) return this.caregiverByName.get(key);
    return 'mock-caregiver-1';
  }

  async resolvePayCodeId(payCodeName: string): Promise<string | undefined> {
    this.calls.push('resolvePayCodeId');
    return this.payCodes.get(payCodeName.trim().toUpperCase());
  }

  async resolveContractId(programType: string | undefined): Promise<number | undefined> {
    this.calls.push('resolveContractId');
    return lookupContractId(programType);
  }

  async resolveServiceCodeId(
    serviceType: string | undefined,
    _contractId?: number,
    programType?: string,
  ): Promise<string | undefined> {
    this.calls.push('resolveServiceCodeId');
    const alias = lookupServiceCodeAlias(serviceType, programType);
    if (alias?.hhaCode) return alias.hhaCode;
    // Mock has no contract rows: expose mapped HHA *name* as a sentinel so callers
    // can assert map-first behavior without live HHA.
    if (alias?.hhaServiceCodeName) return `alias:${alias.hhaServiceCodeName}`;
    return lookupServiceCode(serviceType)?.hhaCode;
  }

  async getClockingDetails(visitId: string, expected: HhaVisit): Promise<HhaClockingDetails> {
    this.calls.push('getClockingDetails');
    const visit = [...this.visits.values()].find((v) => v.id === visitId);
    const clockIn = visit?.startTime ?? expected.startTime;
    const clockOut = visit?.endTime ?? expected.endTime;
    return {
      visitId,
      clockIn,
      clockOut,
      matchesExpected: Boolean(clockIn && clockOut),
      notes: 'mock clocking',
    };
  }

  async approveVisit(visitId: string): Promise<void> {
    this.calls.push('approveVisit');
    for (const [key, visit] of this.visits) {
      if (visit.id === visitId) {
        this.visits.set(key, { ...visit, approved: true });
        return;
      }
    }
    // Allow approve of unknown visit in mock (locate may have used different key)
    this.visits.set(visitId, {
      patientId: 'unknown',
      id: visitId,
      approved: true,
    });
  }

  async listPatientPlacements(
    patientId: string,
    _visitDate?: string,
  ): Promise<PatientPlacementSummary[]> {
    this.calls.push('listPatientPlacements');
    return [...(this.placementsByPatient.get(patientId) ?? [])];
  }

  async dischargePlacement(options: DischargePlacementOptions): Promise<void> {
    this.calls.push('dischargePlacement');
    const list = this.placementsByPatient.get(options.patientId) ?? [];
    const idx = list.findIndex((p) => p.placementId === options.placementId);
    if (idx < 0) {
      throw new Error(`Mock placement ${options.placementId} not found for patient ${options.patientId}`);
    }
    list[idx] = {
      ...list[idx]!,
      dischargeDate: options.dischargeDate ?? new Date().toISOString().slice(0, 10),
    };
    this.placementsByPatient.set(options.patientId, list);
    this.dischargedPlacements.add(options.placementId);
  }

  async dischargeAllPlacements(options: DischargeAllPlacementsOptions): Promise<void> {
    this.calls.push('dischargeAllPlacements');
    const active = (this.placementsByPatient.get(options.patientId) ?? []).filter(
      (p) => !p.dischargeDate,
    );
    for (const placement of active) {
      await this.dischargePlacement({
        patientId: options.patientId,
        placementId: placement.placementId,
        dischargeDate: options.dischargeDate,
      });
    }
  }

  async dischargeService(update: DischargeServiceUpdate): Promise<void> {
    this.calls.push('dischargeService');
    const patientId =
      (isTrustedHhaPatientId(update.patientId, update.caseId)
        ? update.patientId!.trim()
        : undefined) ??
      (await this.findPatient(
        toFindPatientOptions({
          caseId: update.caseId,
          patientExternalId: update.caseId,
          firstName: update.firstName,
          lastName: update.lastName,
          dateOfBirth: update.dateOfBirth,
        }),
      )) ??
      update.caseId;
    const active = (this.placementsByPatient.get(patientId) ?? []).filter((p) => !p.dischargeDate);
    const contractId = await this.resolveContractId(update.programType);
    const placementId = resolvePlacementForService({
      serviceCode: update.serviceCode,
      startDate: update.startDate,
      contractId,
      active,
    });
    await this.dischargePlacement({
      patientId,
      placementId,
      dischargeDate: update.dischargeDate,
    });
  }

  async updateClosedCase(update: ClosedCaseUpdate): Promise<void> {
    this.calls.push('updateClosedCase');
    this.closedCases.set(update.caseId, update);
    const patientId =
      (isTrustedHhaPatientId(update.patientId, update.caseId)
        ? update.patientId!.trim()
        : undefined) ??
      (await this.findPatient(
        toFindPatientOptions({
          caseId: update.caseId,
          patientExternalId: update.caseId,
          firstName: update.firstName,
          lastName: update.lastName,
          dateOfBirth: update.dateOfBirth,
        }),
      )) ??
      update.caseId;
    await this.dischargeAllPlacements({
      patientId,
      dischargeDate: update.closedDate,
    });
  }

  async validateTransfer(externalRefs: string[]): Promise<{ ok: boolean; missing: string[] }> {
    this.calls.push('validateTransfer');
    const known = new Set([
      ...this.patients.keys(),
      ...[...this.patients.values()].map((p) => p.id),
      ...this.closedCases.keys(),
      ...[...this.visits.values()].map((v) => v.id),
    ]);
    const missing = externalRefs.filter((ref) => !known.has(ref));
    return { ok: missing.length === 0, missing };
  }
}
