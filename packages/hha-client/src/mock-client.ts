import { randomUUID } from 'node:crypto';
import type { HhaClockingDetails, HhaPatient, HhaVisit } from '@white-glove/shared';
import { lookupContractId, lookupServiceCode } from '@white-glove/shared';
import type { ClosedCaseUpdate, HhaClient, PendingCall, UpsertResult } from './types.js';

/**
 * In-memory mock used until HHA sandbox + API docs are available.
 */
export class MockHhaClient implements HhaClient {
  readonly patients = new Map<string, HhaPatient & { id: string }>();
  readonly contracts = new Map<string, UpsertResult>();
  readonly authorizations = new Map<string, UpsertResult>();
  readonly visits = new Map<string, HhaVisit & { id: string; approved: boolean }>();
  readonly closedCases = new Map<string, ClosedCaseUpdate>();
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
    const key = contract.contractExternalId ?? `${contract.patientId}:${contract.serviceCode ?? ''}`;
    const existing = this.contracts.get(key);
    if (existing) return { id: existing.id, created: false };
    const result = { id: randomUUID(), created: true };
    this.contracts.set(key, result);
    return result;
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

  async updateClosedCase(update: ClosedCaseUpdate): Promise<void> {
    this.calls.push('updateClosedCase');
    this.closedCases.set(update.caseId, update);
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
