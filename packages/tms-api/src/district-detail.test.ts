import { describe, expect, it } from 'vitest';
import { MemoryStore, newId, nowIso } from '@white-glove/tms-db';
import { handleTmsRequest } from './router.js';

process.env.TMS_ALLOW_DEV_HEADERS = '1';

const adminH = { 'x-tms-role': 'admin', 'x-tms-email': 'admin@whiteglove.local' };

function storeWithAdmin() {
  const store = new MemoryStore();
  store.upsertUser({
    id: newId(),
    cognitoSub: 'a',
    email: 'admin@whiteglove.local',
    role: 'admin',
    displayName: 'Admin',
    providerId: '',
    active: true,
    createdAt: nowIso(),
  });
  return store;
}

describe('admin district detail', () => {
  it('opens caseload-derived and stored districts', async () => {
    const store = storeWithAdmin();
    const cherry = store.upsertSchool({
      id: newId(),
      name: 'Cherry Lane School',
      district: '',
      signerName: '',
      signerEmail: '',
      createdAt: nowIso(),
    });
    store.upsertStudent({
      id: newId(),
      schoolId: cherry.id,
      firstName: 'A',
      lastName: 'Kid',
      dob: '',
      programId: '',
      programType: 'Carle Place UFSD',
      hhaPatientId: '',
      createdAt: nowIso(),
    });
    const powells = store.upsertSchool({
      id: newId(),
      name: 'Powells Lane',
      district: 'Westbury UFSD',
      signerName: 'Building Signer',
      signerEmail: 'building@school.test',
      createdAt: nowIso(),
    });
    const saved = store.upsertDistrict({
      id: newId(),
      name: 'Westbury UFSD',
      signerName: 'District Signer',
      signerEmail: 'signer@district.test',
      createdAt: nowIso(),
    });

    const list = await handleTmsRequest(store, {
      method: 'GET',
      path: '/admin/districts',
      headers: adminH,
      query: {},
      body: undefined,
    });
    expect(list.status).toBe(200);
    const districts = (list.body as { districts: Array<{ id: string; name: string; persisted: boolean }> })
      .districts;
    const derived = districts.find((d) => d.name === 'Carle Place UFSD');
    expect(derived?.persisted).toBe(false);
    expect(derived?.id).toBe('derived:carle place');

    const encodedPath = `/admin/districts/${encodeURIComponent(derived!.id)}`;
    expect(encodedPath).toBe('/admin/districts/derived%3Acarle%20place');
    const byPath = await handleTmsRequest(store, {
      method: 'GET',
      path: encodedPath,
      headers: adminH,
      query: {},
      body: undefined,
    });
    expect(byPath.status).toBe(200);
    const pathBody = byPath.body as {
      district: { name: string; schools: Array<{ id: string }>; persisted: boolean };
    };
    expect(pathBody.district.name).toBe('Carle Place UFSD');
    expect(pathBody.district.persisted).toBe(false);
    expect(pathBody.district.schools.map((s) => s.id)).toEqual([cherry.id]);

    const byQuery = await handleTmsRequest(store, {
      method: 'GET',
      path: '/admin/districts',
      headers: adminH,
      query: { id: 'derived:carle place' },
      body: undefined,
    });
    expect(byQuery.status).toBe(200);
    expect((byQuery.body as { district: { name: string } }).district.name).toBe('Carle Place UFSD');

    const byEncodedQuery = await handleTmsRequest(store, {
      method: 'GET',
      path: '/admin/districts',
      headers: adminH,
      query: { id: 'derived%3Acarle%20place' },
      body: undefined,
    });
    expect(byEncodedQuery.status).toBe(200);

    const byPlus = await handleTmsRequest(store, {
      method: 'GET',
      path: '/admin/districts',
      headers: adminH,
      query: { id: 'derived:carle+place' },
      body: undefined,
    });
    expect(byPlus.status).toBe(200);

    const byName = await handleTmsRequest(store, {
      method: 'GET',
      path: '/admin/districts',
      headers: adminH,
      query: { id: 'Carle Place UFSD' },
      body: undefined,
    });
    expect(byName.status).toBe(200);
    expect((byName.body as { district: { schools: Array<{ id: string }> } }).district.schools[0].id).toBe(
      cherry.id,
    );

    const westburyByName = await handleTmsRequest(store, {
      method: 'GET',
      path: '/admin/districts',
      headers: adminH,
      query: { id: 'Westbury UFSD' },
      body: undefined,
    });
    expect(westburyByName.status).toBe(200);
    expect((westburyByName.body as { district: { id: string } }).district.id).toBe(saved.id);

    const stored = await handleTmsRequest(store, {
      method: 'GET',
      path: `/admin/districts/${saved.id}`,
      headers: adminH,
      query: {},
      body: undefined,
    });
    expect(stored.status).toBe(200);
    const storedBody = stored.body as {
      district: {
        id: string;
        persisted: boolean;
        signerEmail: string;
        schools: Array<{ id: string }>;
      };
    };
    expect(storedBody.district.id).toBe(saved.id);
    expect(storedBody.district.persisted).toBe(true);
    expect(storedBody.district.signerEmail).toBe('signer@district.test');
    expect(storedBody.district.schools.map((s) => s.id)).toEqual([powells.id]);

    const missing = await handleTmsRequest(store, {
      method: 'GET',
      path: '/admin/districts/derived%3Anot%20a%20district',
      headers: adminH,
      query: {},
      body: undefined,
    });
    expect(missing.status, JSON.stringify(missing.body)).toBe(404);
  });
});
