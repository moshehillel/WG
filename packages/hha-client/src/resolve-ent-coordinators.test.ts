import { describe, expect, it } from 'vitest';
import { resolveEntCoordinatorIds } from './resolve-ent-coordinators.js';

describe('resolveEntCoordinatorIds', () => {
  it('does not emit Abigail or Esty when the coordinator env is missing or wrong', async () => {
    for (const raw of [undefined, '', '67321', '81103', '68033', '6573', '81103,68033']) {
      const ids = await resolveEntCoordinatorIds('token', {
        HHA_ENT_COORDINATOR_ID: raw,
      } as NodeJS.ProcessEnv);
      expect(ids).toBe('84898,67321,67322');
      expect(ids.split(',')).not.toContain('81103');
      expect(ids.split(',')).not.toContain('68033');
    }
  });
});
