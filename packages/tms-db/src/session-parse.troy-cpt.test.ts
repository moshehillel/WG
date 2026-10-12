import { describe, expect, it } from 'vitest';
import { parseWeeklySessionText } from './session-parse.js';
import { cptDurationError } from './session-upload-validate.js';

const TROY_NOTE =
  "Service Provided: Troy engaged in LE PRE's (10x), balance and coordination training, motor planning activity. He presents with fair-endurance and weakness in LE/core. VC and visual demonstration required, along with frequent rest periods. Slight improvement noted with motor planning";

const HEADER = `
District/Agency/BOCES: Valley Stream Union Free School District Thirty
Summary of Related Service Session Notes
Service: Physical Therapy
Service Provider: Dawan, Fatimah (White Glove)
From: 10/04/2026 To: 10/10/2026
Student Name: Atkins, Troy
`;

function signatureBlock(): string {
  return `
Telehealth: No
Provider Signature/Credentials: Fatimah (White Glove) Dawan PT (NPI# 1710165295) (License# 02934701)
Date
Oct 9 2026 10:39AM
`;
}

function coverageOf(row: {
  beginTime: string;
  endTime: string;
  cptCodes: string[];
  cptUnits: number;
  cptProcedures: string[];
  attendance: string;
  serviceType: string;
  ratio: string;
}) {
  return cptDurationError(
    row.beginTime,
    row.endTime,
    { codes: row.cptCodes, totalUnits: row.cptUnits, procedures: row.cptProcedures },
    row.attendance,
    { serviceType: row.serviceType, ratio: row.ratio },
  );
}

describe('Troy Atkins 10/08 repeated CPT rows', () => {
  it('reads two printed rows (97110x1 and 97112x1, 12:47–1:17) as one 30-min session', () => {
    const text = `${HEADER}
Drexel Avenue
10/08/2026
1:1
12:47 pm
1:17 pm
${TROY_NOTE}
97110
1
F81.9
${signatureBlock()}
Drexel Avenue
10/08/2026
1:1
12:47 pm
1:17 pm
${TROY_NOTE}
97112
1
F81.9
${signatureBlock()}
`;
    const rows = parseWeeklySessionText(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.beginTime).toMatch(/12:47/i);
    expect(rows[0]?.endTime).toMatch(/1:17/i);
    expect(rows[0]?.cptCodes.sort()).toEqual(['97110', '97112']);
    expect(rows[0]?.cptProcedures.sort()).toEqual(['97110x1', '97112x1']);
    expect(rows[0]?.cptUnits).toBe(2);
    expect(rows[0]?.ratio).toBe('1:1');
    expect(coverageOf(rows[0]!)).toBeNull();
  });

  it('keeps both codes when each CPT is printed before its repeated date row', () => {
    const text = `${HEADER}
97110
1
F81.9
10/08/2026
1:1
12:47 pm
1:17 pm
Drexel Avenue
${TROY_NOTE}
${signatureBlock()}
97112
1
F81.9
10/08/2026
1:1
12:47 pm
1:17 pm
Drexel Avenue
${TROY_NOTE}
${signatureBlock()}
`;
    const rows = parseWeeklySessionText(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cptCodes.sort()).toEqual(['97110', '97112']);
    expect(rows[0]?.cptUnits).toBe(2);
    expect(coverageOf(rows[0]!)).toBeNull();
  });

  it('leaves a real second visit at a different time separate', () => {
    const text = `${HEADER}
10/08/2026
1:1
12:47 pm
1:17 pm
Drexel Avenue
${TROY_NOTE}
97110
1
F81.9
${signatureBlock()}
10/08/2026
1:1
12:47 pm
1:17 pm
Drexel Avenue
${TROY_NOTE}
97112
1
F81.9
${signatureBlock()}
10/08/2026
1:1
2:00 pm
2:30 pm
Drexel Avenue
Service Provided: Troy engaged in a later individual session for gait only.
97110
1
F81.9
${signatureBlock()}
`;
    const rows = parseWeeklySessionText(text);
    const morning = rows.filter((r) => /12:47/.test(r.beginTime));
    const later = rows.filter((r) => /2:00/.test(r.beginTime));
    expect(morning).toHaveLength(1);
    expect(morning[0]?.cptCodes.sort()).toEqual(['97110', '97112']);
    expect(coverageOf(morning[0]!)).toBeNull();
    expect(later).toHaveLength(1);
    expect(later[0]?.cptCodes).toEqual(['97110']);
    expect(later[0]?.cptCodes).not.toContain('97112');
    expect(coverageOf(later[0]!)).toMatch(/need 2 unit/i);
  });

  it('does not let an untimed code cover the other 15 minutes', () => {
    expect(
      cptDurationError('12:47 pm', '1:17 pm', '97112x1, 97150x1', 'attended', { ratio: '1:1' }),
    ).toMatch(/need 2 unit/i);
    expect(cptDurationError('12:47 pm', '1:17 pm', '97150x1', 'attended')).toBeNull();
    expect(cptDurationError('12:47 pm', '1:17 pm', '92507x1', 'attended')).toBeNull();
    expect(cptDurationError('12:47 pm', '1:17 pm', '97165x1', 'attended')).toBeNull();
    expect(
      cptDurationError('12:47 pm', '1:17 pm', '97112x1, 97110x1', 'attended', { ratio: '1:1' }),
    ).toBeNull();
  });
});
