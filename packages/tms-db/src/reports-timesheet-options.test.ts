import { describe, expect, it } from 'vitest';
import { MemoryStore } from './memory-store.js';
import { nowIso, newId } from './ids.js';
import { buildTimesheetProgramOptions } from './reports.js';

function seedProvider(store: MemoryStore, providerId: string) {
  store.upsertProvider({
    id: providerId,
    userId: '',
    firstName: 'Pat',
    lastName: 'Provider',
    discipline: 'PT',
    payRatePerHour: null,
    payRate30Min: null,
    payRate42Min: null,
    payRate45Min: null,
    payRateGroup30Min: null,
    payRateGroup42Min: null,
    payRateGroup45Min: null,
    payRateEval: null,
    payRateAdditionalHourly: null,
    hhaCaregiverCode: '',
    active: true,
    createdAt: nowIso(),
  });
}

describe('buildTimesheetProgramOptions', () => {
  it('collapses same-signer buildings under one program type label', () => {
    const store = new MemoryStore();
    const providerId = newId();
    seedProvider(store, providerId);
    const high = store.upsertSchool({
      id: newId(),
      name: 'Carle Place High School',
      district: '',
      signerName: 'CP Signer',
      signerEmail: 'cp@school.test',
      createdAt: nowIso(),
    });
    const middle = store.upsertSchool({
      id: newId(),
      name: 'Carle Place Middle School',
      district: '',
      signerName: 'CP Signer',
      signerEmail: 'cp@school.test',
      createdAt: nowIso(),
    });
    const island = store.upsertSchool({
      id: newId(),
      name: 'Francis X. Hegarty Elementary School',
      district: '',
      signerName: 'IP Signer',
      signerEmail: 'ip@school.test',
      createdAt: nowIso(),
    });
    for (const [schoolId, programType, first] of [
      [high.id, 'Carle Place UFSD', 'A'],
      [middle.id, 'Carle Place UFSD', 'B'],
      [island.id, 'Island Park UFSD', 'C'],
    ] as const) {
      const studentId = newId();
      store.upsertStudent({
        id: studentId,
        schoolId,
        firstName: first,
        lastName: 'Kid',
        dob: '',
        programId: '',
        programType,
        hhaPatientId: '',
        createdAt: nowIso(),
      });
      store.upsertMandate({
        id: newId(),
        studentId,
        providerId,
        serviceType: 'PT School',
        discipline: 'PT',
        frequencyPerWeek: 1,
        frequencyKind: 'weekly',
        sessionsPerPeriod: 1,
        ratioGroup: false,
        sourcePdfKey: '',
        parsedAt: nowIso(),
        startOn: '',
        endOn: '',
        createdAt: nowIso(),
      });
    }

    const opts = buildTimesheetProgramOptions(store, [providerId]);
    expect(opts.map((o) => o.label)).toEqual(['Carle Place UFSD', 'Island Park UFSD']);
    expect(opts.every((o) => !o.id)).toBe(true);
  });

  it('splits one program type when signer emails differ', () => {
    const store = new MemoryStore();
    const providerId = newId();
    seedProvider(store, providerId);
    const a = store.upsertSchool({
      id: newId(),
      name: 'Building A',
      district: '',
      signerName: 'Signer A',
      signerEmail: 'a@school.test',
      createdAt: nowIso(),
    });
    const b = store.upsertSchool({
      id: newId(),
      name: 'Building B',
      district: '',
      signerName: 'Signer B',
      signerEmail: 'b@school.test',
      createdAt: nowIso(),
    });
    for (const school of [a, b]) {
      const studentId = newId();
      store.upsertStudent({
        id: studentId,
        schoolId: school.id,
        firstName: 'Kid',
        lastName: school.name,
        dob: '',
        programId: '',
        programType: 'Shared UFSD',
        hhaPatientId: '',
        createdAt: nowIso(),
      });
      store.upsertMandate({
        id: newId(),
        studentId,
        providerId,
        serviceType: 'PT School',
        discipline: 'PT',
        frequencyPerWeek: 1,
        frequencyKind: 'weekly',
        sessionsPerPeriod: 1,
        ratioGroup: false,
        sourcePdfKey: '',
        parsedAt: nowIso(),
        startOn: '',
        endOn: '',
        createdAt: nowIso(),
      });
    }

    const opts = buildTimesheetProgramOptions(store, [providerId]);
    expect(opts.map((o) => o.label).sort()).toEqual([
      'Shared UFSD · Signer A',
      'Shared UFSD · Signer B',
    ]);
    expect(opts.every((o) => o.id && o.programType === 'Shared UFSD')).toBe(true);
  });
});
