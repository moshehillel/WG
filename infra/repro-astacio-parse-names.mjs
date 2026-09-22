import { parseTherapistActivityText } from '../packages/tms-db/dist/session-parse.js';

const cases = {
  'note-frag': `Therapist Activity Printed: 9/17/2026
09/17/26 In: 11:00 AM Out: 11:30 AM Preschool
However, with prompting the student produced the target sound.
Notes Entered: 9/17/2026
Signed: 9/17/2026 Wiglishai Astacio, M.S., CCC-SLP, TSSLD
Page 1 of 1 Astacio, Wiglishai
`,
  'sig-only': `Therapist Activity Printed: 9/16/2026
09/16/26 In: 09:30 AM Out: 10:00 AM Preschool
Signed: 9/16/2026 Wiglishai Astacio, M.S., CCC-SLP, TSSLD
Page 1 of 1 Astacio, Wiglishai
`,
  'real-jr': `Therapist Activity Printed: 9/16/2026
09/16/26 In: 10:00 AM Out: 10:30 AM Preschool JR, MICHAEL CBRS2627S0011111(ST-I) F80.2 92507x1
Michael participated well.
Notes Entered: 9/16/2026
Signed: 9/16/2026 Wiglishai Astacio, M.S., CCC-SLP, TSSLD
Page 1 of 1 Astacio, Wiglishai
`,
  'cred-loose': `Therapist Activity Printed: 9/16/2026
09/16/26 In: 09:30 AM Out: 10:00 AM Preschool
Astacio, M.S., CCC-SLP notes fragment without program id
Notes Entered: 9/16/2026
Signed: 9/16/2026 Wiglishai Astacio, M.S., CCC-SLP, TSSLD
Page 1 of 1 Astacio, Wiglishai
`,
};

for (const [label, text] of Object.entries(cases)) {
  const rows = parseTherapistActivityText(text);
  console.log(
    label,
    rows.map((r) => ({
      studentName: r.studentName,
      begin: r.beginTime,
      end: r.endTime,
      notes: String(r.notes || '').slice(0, 70),
    })),
  );
}
