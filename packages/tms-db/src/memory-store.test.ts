import { describe, expect, it } from 'vitest';
import { emptySnapshot } from './types.js';
import { MemoryStore } from './memory-store.js';

describe('MemoryStore.load', () => {
  it('fills missing arrays so admin notes can be saved', () => {
    const store = new MemoryStore();
    const partial = emptySnapshot() as unknown as Record<string, unknown>;
    delete partial.adminNotes;
    store.load(partial as never);
    expect(Array.isArray(store.data.adminNotes)).toBe(true);
    const note = store.addAdminNote({
      id: 'n1',
      providerId: 'p1',
      authorId: 'a1',
      body: 'office only',
      createdAt: '2026-09-02T00:00:00.000Z',
    });
    expect(note.body).toBe('office only');
    expect(store.notesForProvider('p1')).toHaveLength(1);
  });
});
