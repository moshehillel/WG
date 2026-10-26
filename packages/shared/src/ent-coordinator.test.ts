import { describe, expect, it } from 'vitest';
import { resolveSessionCoordinatorIds } from './ent-coordinator.js';

describe('resolveSessionCoordinatorIds', () => {
  it('stays Billu and both Grace ids when the env is missing or names someone else', () => {
    for (const raw of [undefined, '', '67321', '81103', '68033', '6573', '81103,68033', '84898']) {
      const ids = resolveSessionCoordinatorIds(raw);
      expect(ids).toBe('84898,67321,67322');
      expect(ids).not.toContain('81103');
      expect(ids).not.toContain('68033');
      expect(ids).not.toContain('6573');
    }
  });
});
