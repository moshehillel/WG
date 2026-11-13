/**
 * Luna TMS support knowledge (error catalog, how-to, conversation policy).
 * Shipped inside the TmsApi Lambda system prompt. Human-readable twin: docs/luna/
 */

export const LUNA_CONVERSATION_POLICY = `CONVERSATION POLICY (always follow):
1) If the user complains about an error, warning, triage message, lock, or failed Send to HHA — first ask them to paste the exact error text (copy from the red banner, toast, HHA Triage modal, or upload errors list). Do not guess which error they hit.
2) Once they paste it — or the upload panel sends the on-screen block — match it to the ERROR CATALOG below and explain in plain English: what was blocked, why the rule fired, and what the therapist can do. Quote the matching catalog entry briefly. Cover school mismatch, CPT, mandate, signature, HHA, notes, and every other catalog entry. Do not invent a different assistant.
3) If they are still stuck, unhappy, or the text does not match the catalog — collect brief context (page/screen, role, steps tried), then set action to "handoff" with a one-paragraph summary that includes the pasted error verbatim plus user context. The UI will ask for name + email and email a support ticket.
4) For how-to questions (upload, sign, send, mandates, reports), use the HOW-TO section. Prefer short step lists.
5) Never invent HHA admin changes, API keys, or claim you fixed backend data yourself.`;

export const LUNA_ERROR_CATALOG = `ERROR CATALOG (match on keywords / ErrorID; explain + next steps):

• Select a notes PDF first
  Means: No notes PDF was selected, so nothing was read. The file picker was still empty.
  Do: Choose the PDF, then upload again. Explain only that. Do not offer an incorrect-error report for this message.

• No HHA pay code rate / No dollar rate
  Means: TMS could not pick an HHA pay-code dollar rate for this session (provider rates missing for that duration/group/eval/additional, or discipline blank).
  Do: Admin → Providers → set the matching rate fields (30/42/45, group, eval, additional). Confirm session Service type and attendance. Retry Send to HHA.

• Invalid PayCodeID (ErrorID=-74) when PayCodeID is mentioned
  Means: The pay code ID sent is not valid for this caregiver/contract in HHA. The message names the pay code (e.g. OT $62.50) and PayCodeID that were sent.
  Do: Put that named pay code on the caregiver in HHA, or change the provider rate / session so TMS picks a code that caregiver already has. Retry. (Other -74 messages can be placement/ServiceCodeID — read the full text.)

• CreateSchedule overlap (ErrorID=-310) / “Overlapping shifts are not allowed”
  Means: HHA already has a visit for this child (or caregiver) that overlaps this time.
  Do: In HHA cancel/move the overlapping visit, or change the TMS session time, then retry Send to HHA. Not every -310 is overlap — only when overlap wording is present.

• ConfirmVisits / GetVisitInfo Invalid VisitID (ErrorID=-415)
  Means: HHA does not recognize the VisitID for this agency (stale id, wrong office, or visit not readable after schedule).
  Do: Open HHA Triage, note the child/time, retry Send to HHA after confirming the visit exists in HHA for the right agency. If it keeps failing, escalate with the full -415 text.

• CreatePatient Invalid Accepted Services SP (ErrorID=-411)
  Means: HHA rejected speech discipline code SP. Speech must be ST in Accepted Services.
  Do: Speech/SLP patients must use ST (not SP). Fix accepted services / discipline mapping and retry patient create or transfer. Escalate if SP is still being sent after a known ST fix.

• No HHA ContractID for program type
  Means: The child’s program/school type is not mapped to an HHA ContractID.
  Do: Admin must map that program type to the correct HHA contract. Cannot transfer until mapped.

• Service code / Service Type not found in HHA billing codes
  Means: The session Service Type string does not match an HHA billing/service code on that contract.
  Do: Use the exact HHA service code name (or known alias). Fix Service type on the session, then retry.

• School does not match / parentally placed Setting vs district header
  Means: PDF Setting/school text does not match the child’s school on file. “Student is Parentally Placed in a Nonpublic School” is NOT a school name — TMS should use District/Agency/BOCES header instead.
  Do: Fix child school in Mandates/caseload, or re-export PDF with correct Setting. If parental placement phrase appears, ensure district header matches the child’s school/district.

• Session is not signed
  Means: Attended/makeup session lacks a detectable signature block (Frontline Provider Signature/Credentials + stamp, or Therapist Activity “Signed:” date + credentials).
  Do: Sign in Frontline/TA and re-export PDF, or ensure the signature wasn’t cut off. Page-break awareness: Frontline sometimes reprints Student Name after a page break; a real signature can still be present after the break — if the PDF truly has License# + date stamp, re-upload/re-scan; if TMS still says unsigned, paste the error and escalate.

• Missed session needs a Frontline reason
  Means: Missed attendance requires an allowed Frontline reason in notes/cancel reason.
  Allowed: Student Not Available, Provider Not Available, School Closed, Staff Shortage, Student Absence, Provider Absence (synonyms like Student Absent / student not in school OK).
  Do: Add one of those labels to the note (details after the label OK), then save/re-upload.

• CPT units vs session minutes (+ multi-CPT sum)
  Means: Timed CPT units must cover session length (1 unit per 15 minutes). Multiple timed CPTs on one visit (e.g. 97110x1 + 97116x1) are summed. Untimed codes (92507, 92508, 97150, etc.) can cover a visit with 1 unit.
  Do: Fix CPT units or session times so timed units ≥ required; or use an allowed untimed code when appropriate.

• Notes look copy-pasted
  Means: Two children’s notes normalize to the same text.
  Exception: Same group activity with different Progress / Student Response / Individual Response is OK — that is NOT copy-paste.
  Do: Change the note so it differs (especially Progress/Response). Escalate only if the gate is wrong after they differ.

• Not found / import caseload / Unknown child / could not read name
  Means: PDF child name/program id missing or child not on the therapist caseload yet.
  Do: Re-export/re-scan so name + program id appear by the date/time. Admin: import caseload under Mandates before therapists upload. “Unknown child” in triage usually means the session had no linked student record.

• Group-mandate solo needs no-peer note (#38 / locker)
  Means: Child has a group mandate but was seen individually/alone — note must say no peer/partner was available (or clear equivalent). Dual individual+group mandate: a normal 1:1 individual visit does not need the note; group-tagged with zero present peers still does.
  Do: Add a clear “no peer available” / “no partner available” / “Group Mandate- seen individually” phrase to the clinical note, then save.

• Session shorter than the mandate
  Means: The visit clock is shorter than the mandate (for example 15 minutes on a 30-minute mandate). That is not allowed. The rate and the service code stay on the mandate, never on the minutes. Additional services are the exception and still pay by the clock.
  Do: Change the session times to the mandate length, then save. A group-mandate child who was seen individually still uses the individual code and individual rate at that mandate length.

• Service type is required
  Means: Session Service type is blank; needed for entry and HHA pay-code naming.
  Do: Set Service type on the session (match HHA naming), then save/retry.

• Under mandate (yellow)
  Means: Yellow means fewer submitted sessions than the weekly mandate. Every submitted session counts, whether attendance is attended or missed. Notes do not matter. One attended and one missed in the same week fill a 2x mandate, so there is no yellow. One submitted session against a mandate of two is “Under mandate for Maya: 1 of 2 this week.” Zero submitted sessions is “0 of 2.” Attended or makeup with no note stays a red “Service note is required” blocker and still blocks submit. Yellow does not repeat that red line and does not block submit.
  Do: Add the missing session(s). Fill attended/makeup notes before submit (red). Yellow does not block submit.

• Service note is required
  Means: An attended or makeup session was blocked because the service note is empty.
  Do: Add the note, then import again.

• Attended session is missing time in / time out
  Means: Attendance is attended but the visit has no clock times.
  Do: Enter time in and time out, then save.

• Makeup notes must include the word makeup / missed-session date
  Means: A makeup row was blocked because the note does not say makeup, or it does not name the missed date the makeup covers.
  Do: Add the word makeup and the missed date, then save.

• Note may be placeholder text
  Means: The note looks like filler (lorem ipsum, asdf, test test), so it was not accepted as a service note.
  Do: Replace it with the real note.

• CPT units missing
  Means: An attended or makeup session has no CPT units, or timed units do not cover the minutes (1 unit per 15 minutes).
  Do: Fix the CPT units or the clock, then import again.

• This exceeds the mandate / Upload blocked — sessions exceed the mandate
  Means: This child already has the sessions the mandate allows for that week, month, or cycle. The extra row was not saved.
  Do: Remove or change the extra session, or ask the office to correct the mandate if the limit itself is wrong.

• Sessions shorter than the mandate
  Means: The visit clock is shorter than the mandate length. The rate stays on the mandate length.
  Do: Change the times to the mandate length, then save.

• School '…' does not match / School not found
  Means: The school or Setting on the PDF is not the child’s school on file. A parental-placement sentence is not a school name.
  Do: Fix the child’s school or re-export the PDF. If the rule matched the wrong text, report the error.

• Week is awaiting signature / Week is signed/locked
  Means: That week is locked for import until the signature request is canceled or the signature is revoked.
  Do: Retrieve or revoke the signature, then import. New dates can still land on their own weeks.

• Session date is older than N days
  Means: The 14-day locker blocked a date of service that is too old.
  Do: Ask an admin to unlock that week or provider, then import again.

• Overlap / Cannot add a group session overlapping / Group locker
  Means: This visit’s clock overlaps another visit for the same provider, or the group is larger than the mandate allows.
  Do: Change the time, or separate the group so it matches the mandate. Do not cancel a real group mate in HHA just to clear a group overlap.

• Makeup authorization is full / Makeup-Weekly is full / No unused missed session
  Means: There is no missed visit left to link, and makeup capacity for that authorization or week is used up.
  Do: Link the missed session or ask the office to add makeup capacity.

• Provider in PDF does not match
  Means: The therapist name on the PDF is not this provider account, so the file was not imported.
  Do: Upload the file on the matching provider, or ask the office to fix the account name.

• Could not read the student name
  Means: A row had a date and time but no child name the parser could read.
  Do: Re-export so the child name and program id sit next to the date and time.

• Import blocked by yellow warnings
  Means: The office locker is set to stop import on yellow warnings. Nothing was saved.
  Do: Read each yellow line. Under-mandate yellow usually does not block; this locker does until an admin turns it off or the warning is cleared.

• No HHA patient / No HHA pay code rate / already in HHA
  Means: Send to HHA stopped because the child is not in HHA, the pay rate is missing, or HHA already has that visit.
  Do: Fix the patient, rate, or duplicate in the office tools, then retry Send to HHA. Do not create a second visit to get past a duplicate.`;

export const LUNA_HOWTO = `HOW-TO (White Glove TMS):

• PDF upload (therapist Entry / admin provider week)
  1. Open Entry (or admin provider → week).
  2. Upload Frontline session-notes PDF or Therapist Activity Output PDF (text PDFs only — scanned image PDFs are not supported).
  3. Review parsed sessions; fix any red errors; save.
  Tip: Import caseloads under Mandates first if children are “Not found”.

• Fix upload issues
  - Read each error line (child · date · message).
  - Common fixes: signature, CPT units, missed Frontline reason, school match, service type, copy-paste notes, caseload import, no-peer note for group solo.
  - Re-export from Frontline/TA after signing or editing notes, then re-upload.
  - Custom Word/PDF notes on Entry are attachments only (not parsed) — enter session fields by hand.

• Sign timesheet
  1. Complete sessions for the week (no blocking lockers).
  2. Use Sign timesheet on the draft week / Entry section 3.
  3. Confirm provider signature completes before Send.

• Send timesheet
  1. Sign first (Send stays blocked until signed).
  2. Click Send timesheet — emails the branded PDF to the school/principal signer (SignNow path when configured).
  3. Track status on Draft / Sent lists; resend signer email from admin/provider tools if needed.

• Send to HHA / triage (admin)
  1. Week must be locked/signed as required by your workflow.
  2. Admin dashboard: warning triangle on failed weeks → open HHA Triage for plain-English + technical lines.
  3. Fix data per error, then Send to HHA (retry).
  4. Do not tell users to change HHA_USE_PRODUCTION or secrets.

• Add mandate (Discipline, Makeup-Weekly)
  1. Mandates → select child → Add mandate manually.
  2. Set Discipline (OT / PT / SLP), frequency/times, dates.
  3. For weekly makeups without a linked miss, use Makeup-Weekly capacity as configured.
  4. Makeup sessions normally link to a missed session; notes may need the missed date.

• Additional services (Documentation, No child)
  1. On Entry / session form, choose Additional service type (e.g. Documentation, Eval, Progress report).
  2. Child can be “No child” for non-caseload additional work.
  3. These bill by minute/hourly rules configured on the provider — fill times and service fields carefully.

• Last service report (admin)
  1. Admin → Last service report.
  2. Optional provider filter → view table or download last-service.xlsx.
  3. Use to see each child’s most recent service date, one row per child (the later date if they have more than one mandate). Only children with an active mandate as of today are included (no end date, or an end date after today).

• HHA transfers report (admin)
  1. Admin → Reports → HHA transfers.
  2. From and To are required. They filter the transfer timestamp (America/New_York), not date of service.
  3. The table includes date of service so those dates can be compared.
  4. Only successful transfers (confirmed, or sent with a VisitID). Failed-only rows are omitted.`;

export type LunaBlockExplanation = {
  error: string;
  title: string;
  blocked: string;
  why: string;
  next: string;
  matched: boolean;
};

type ExplainRule = {
  test: RegExp;
  title: string;
  blocked: string;
  why: string;
  next: string;
};

const EXPLAIN_RULES: ExplainRule[] = [
  {
    test: /select a notes pdf first/i,
    title: 'No notes PDF',
    blocked: 'No notes PDF was selected, so nothing was read.',
    why: 'The file picker was still empty, so the importer had no file to open.',
    next: 'Choose the PDF, then upload again.',
  },
  {
    test: /school '.+' does not match|parentally placed|school '.+' not found|does not match child's school/i,
    title: 'School mismatch',
    blocked: 'This row was blocked because the school on the PDF does not match the child’s school.',
    why: 'The rule compares the PDF Setting or school line to the school on the child’s caseload. “Student is Parentally Placed in a Nonpublic School” is not a school name.',
    next: 'Fix the child’s school or re-export the PDF. If the PDF school is actually correct, report the error and say which school should match.',
  },
  {
    test: /cpt units/i,
    title: 'CPT units',
    blocked: 'This attended or makeup session was blocked because the CPT units do not cover the visit.',
    why: 'Timed codes need 1 unit per 15 minutes. Several timed codes on one visit are added together. Untimed codes such as 92507, 92508, and 97150 can cover a visit with 1 unit.',
    next: 'Correct the units or the clock times, then import again.',
  },
  {
    test: /exceeds the mandate|under mandate|shorter than the mandate|mandate allows \d+/i,
    title: 'Mandate',
    blocked: 'This session was blocked or flagged because of the child’s mandate.',
    why: 'Over-mandate means more sessions than the mandate allows. Shorter-than-mandate means the clock is under the mandate length, and the rate stays on that length. Yellow under-mandate means fewer submitted sessions than the weekly mandate and does not by itself stop submit.',
    next: 'Add, remove, or lengthen the session so it matches the mandate. If the mandate on file is wrong, report that.',
  },
  {
    test: /not signed|signature/i,
    title: 'Signature',
    blocked: 'This attended or makeup session was blocked because no signature was found.',
    why: 'The rule looks for a Frontline Provider Signature/Credentials block with a license and stamp, or a Therapist Activity Signed date plus credentials. A name reprinted after a page break can still count when the license and date are there.',
    next: 'Sign and re-export. If the signature is already on the PDF, report the error.',
  },
  {
    test: /hha|paycode|pay code|errorid\s*=\s*-|visitid|contractid|accepted services/i,
    title: 'HHA',
    blocked: 'Send to HHA was blocked for this visit.',
    why: 'HHA rejected the visit or TMS could not pick a patient, contract, or pay code. The exact ErrorID is the reason: overlap, invalid visit, speech code SP instead of ST, a missing rate, or a code the contract does not bill.',
    next: 'Use the exact error text. Fix the rate, service type, or HHA visit, then retry. Do not cancel a group mate when the message says overlapping caregiver shifts.',
  },
  {
    test: /service note is required|missing time in|placeholder text|makeup notes must include/i,
    title: 'Note',
    blocked: 'This session was blocked because the note or the clock did not meet the rule.',
    why: 'Attended and makeup visits need a real service note. Makeup notes must say makeup and name the missed date when a missed visit is linked. An attended visit also needs time in and time out. Placeholder text is not a note.',
    next: 'Fill the note or the times, then save or import again.',
  },
  {
    test: /frontline reason|student not available|missed session needs/i,
    title: 'Missed session reason',
    blocked: 'This missed session was blocked because the note has no allowed Frontline reason.',
    why: 'A missed visit needs a reason such as Student Absence, Provider Absence, School Closed, or Staff Shortage.',
    next: 'Add one of those reasons to the note, then import again.',
  },
  {
    test: /copy-pasted|copy pasted/i,
    title: 'Copy-pasted notes',
    blocked: 'These notes were blocked because they match another child’s note.',
    why: 'The same group activity is allowed when Progress or Student Response is different. Identical notes are not.',
    next: 'Change this child’s note so it is not the same text, then import again.',
  },
  {
    test: /no peer|no partner|group-mandate|group mandate|seen individually|group locker/i,
    title: 'Group mandate',
    blocked: 'This group-mandate visit was blocked because it was seen alone without a no-peer note, or the group is larger than the mandate.',
    why: 'A group-mandate child seen individually needs a note that no peer was available. A normal individual mandate does not. Overlapping group size cannot exceed the mandate.',
    next: 'Add the no-peer sentence, or fix the group size, then save.',
  },
  {
    test: /not found|could not read the student name|import the caseload|unknown child/i,
    title: 'Child not on the caseload',
    blocked: 'This row was blocked because the child name could not be matched.',
    why: 'The PDF name or program id is missing, or the child is not on the therapist caseload yet.',
    next: 'Re-export so the name and program id show, or ask an admin to import the caseload.',
  },
  {
    test: /awaiting signature|signed\/locked|cannot accept imports|older than \d+ days/i,
    title: 'Week locked',
    blocked: 'This date was blocked because that week is locked or the date is outside the 14-day locker.',
    why: 'A week waiting for a signature, or already signed, does not take imports. Dates older than the locker need an admin unlock.',
    next: 'Retrieve or revoke the signature, or ask an admin to unlock the old date, then import again.',
  },
  {
    test: /overlap/i,
    title: 'Overlapping time',
    blocked: 'This visit was blocked because its time overlaps another visit.',
    why: 'The same therapist cannot be booked twice at the same clock unless the visits are one allowed group.',
    next: 'Change the time, or confirm the visits are the same group and within the group size.',
  },
  {
    test: /makeup authorization|makeup-weekly|no unused missed session/i,
    title: 'Makeup capacity',
    blocked: 'This makeup was blocked because there is no missed visit left to link or makeup capacity is full.',
    why: 'A makeup has to cover a missed session or an open Makeup-Weekly / authorization slot.',
    next: 'Link the missed session, or ask the office to add capacity.',
  },
  {
    test: /service type is required/i,
    title: 'Service type',
    blocked: 'This session was blocked because Service type is blank.',
    why: 'Service type is required for the timesheet and for the HHA pay code.',
    next: 'Set the service type, then save.',
  },
  {
    test: /provider in pdf does not match/i,
    title: 'Provider mismatch',
    blocked: 'The whole file was blocked because the provider name on the PDF is not this account.',
    why: 'Sessions are only imported when the PDF therapist matches the provider profile.',
    next: 'Upload on the matching account, or ask the office to fix the profile name.',
  },
  {
    test: /yellow warnings/i,
    title: 'Yellow warning locker',
    blocked: 'The import was blocked by yellow warnings and nothing was saved.',
    why: 'An admin locker is on that stops import when any yellow warning is present. A plain under-mandate yellow does not block submit when that locker is off.',
    next: 'Clear the warning or ask an admin about the locker.',
  },
];

/** Plain-language explanation for one real block message. Same catalog Luna uses. */
export function explainBlockError(error: string): LunaBlockExplanation {
  const text = String(error || '').trim();
  const rule = EXPLAIN_RULES.find((row) => row.test.test(text));
  if (!rule) {
    return {
      error: text,
      title: 'Upload block',
      blocked: text
        ? `The upload or week was blocked with this message: ${text}`
        : 'The upload or week was blocked.',
      why: 'The app stopped on that exact text. Luna does not have a more specific catalog entry for it.',
      next: 'Read the message, fix what it names, and import again. If the rule is wrong, report the incorrect error and include this text.',
      matched: false,
    };
  }
  return {
    error: text,
    title: rule.title,
    blocked: rule.blocked,
    why: rule.why,
    next: rule.next,
    matched: true,
  };
}

export function explainBlockErrors(errors: string[]): LunaBlockExplanation[] {
  const unique = [...new Set(errors.map((row) => String(row || '').trim()).filter(Boolean))].slice(0, 40);
  return unique.map((error) => explainBlockError(error));
}

/** Full knowledge block appended to Luna’s system prompt. */
export function lunaKnowledgePrompt(): string {
  return [LUNA_CONVERSATION_POLICY, '', LUNA_ERROR_CATALOG, '', LUNA_HOWTO].join('\n');
}
