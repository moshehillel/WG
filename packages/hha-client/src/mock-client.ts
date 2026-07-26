import { randomUUID } from 'node:crypto';
import type { HhaClockingDetails, HhaPatient, HhaVisit } from '@white-glove/shared';
import { lookupContractId, lookupServiceCode } from '@white-glove/shared';
import type {
  ClosedCaseUpdate,
  DischargeAllPlacementsOptions,
  DischargePlacementOptions,
  DischargeServiceUpdate,
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
  readonly caregiverByName = new Map<string, string>();
  readonly calls: string[] = [];

  async findPatient(options: {
    externalId?: string;
    caseId?: string;
  }): Promise<string | undefined> {
    this.calls.push('findPatient');
    for (const [, patient] of this.patients) {
      if (options.externalId && patient.externalId === options.externalId) return patient.id;
      if (options.caseId && patient.caseId === options.caseId) return patient.id;
    }
    const key = options.externalId ?? options.caseId;
    if (key) {
      const existing = this.patients.get(key);
      if (existing) return existing.id;
    }
    return undefined;
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
    list.push({
      placementId,
      contractId: contract.contractExternalId,
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
    if (!providerName?.trim()) return 'mock-caregiver-1';
    const key = providerName.trim().toUpperCase();
    return this.caregiverByName.get(key) ?? 'mock-caregiver-1';
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
  ): Promise<string | undefined> {
    this.calls.push('resolveServiceCodeId');
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
      update.patientId && /^\d+$/.test(update.patientId)
        ? update.patientId
        : (await this.findPatient({ caseId: update.caseId, externalId: update.caseId })) ??
          update.caseId;
    const active = (this.placementsByPatient.get(patientId) ?? []).filter((p) => !p.dischargeDate);
    const placementId =
      update.placementId ??
      (active.length === 1 ? active[0]!.placementId : undefined);
    if (!placementId) {
      throw new Error(
        `Mock dischargeService: ambiguous placements for ${update.caseId} / ${update.serviceCode ?? 'unknown'}`,
      );
    }
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
      update.patientId && /^\d+$/.test(update.patientId)
        ? update.patientId
        : (await this.findPatient({ caseId: update.caseId, externalId: update.caseId })) ??
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
