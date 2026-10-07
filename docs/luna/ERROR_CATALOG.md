# TMS / HHA / upload error catalog (plain English)

Source of truth for the live bot: `packages/tms-api/src/luna-knowledge.ts`.

## No HHA pay code rate / No dollar rate

**Means:** TMS could not pick an HHA pay-code dollar rate for this session (provider rates missing for that duration/group/eval/additional, or discipline blank).

**Do:** Admin → Providers → set matching rate fields. Confirm session Service type and attendance. Retry Send to HHA.

## Invalid PayCodeID (ErrorID=-74)

**Means:** The pay code ID sent is not valid for this caregiver/contract in HHA (when the message mentions PayCodeID).

**Do:** Align provider rates + session service type with HHA pay rate codes. Retry. Other `-74` texts may be placement/ServiceCodeID — read the full message.

## CreateSchedule overlap (ErrorID=-310)

**Means:** HHA already has a visit overlapping this time (“Overlapping shifts are not allowed” / shift overlapping).

**Do:** Cancel/move the HHA visit or change the TMS time, then retry. Not every `-310` is an overlap.

## ConfirmVisits / GetVisitInfo Invalid VisitID (ErrorID=-415)

**Means:** HHA does not recognize the VisitID for this agency.

**Do:** Confirm the visit in HHA for the right agency; retry Send to HHA. Escalate with the full `-415` text if it persists.

## CreatePatient Invalid Accepted Services SP (ErrorID=-411)

**Means:** HHA rejected speech code **SP**. Speech must be **ST**.

**Do:** Ensure Accepted Services / discipline mapping uses ST for speech/SLP. Retry. Escalate if SP is still sent after the ST fix.

## No HHA ContractID for program type

**Means:** Program/school type is not mapped to an HHA ContractID.

**Do:** Admin maps program type → HHA contract. Transfer blocked until mapped.

## Service code not found in HHA billing codes

**Means:** Session Service Type does not match an HHA billing code on that contract.

**Do:** Use the exact HHA service code (or known alias). Fix Service type, retry.

## School does not match / parentally placed Setting

**Means:** PDF Setting/school does not match the child’s school. “Student is Parentally Placed in a Nonpublic School” is not a school name — use District/Agency/BOCES header.

**Do:** Fix child school or re-export PDF. For parental placement phrases, match district header to the child’s school/district.

## Session is not signed

**Means:** Attended/makeup session lacks a detectable signature (Frontline Provider Signature/Credentials + stamp, or Therapist Activity Signed date + credentials).

**Do:** Sign and re-export. **Page-break awareness:** Frontline may reprint Student Name after a page break; a real License# + date stamp can still count — re-upload if signature is present; escalate if TMS still says unsigned.

## Missed session needs Frontline reason

**Means:** Missed attendance needs an allowed Frontline reason in notes/cancel reason.

**Allowed:** Student Not Available, Provider Not Available, School Closed, Staff Shortage, Student Absence, Provider Absence (synonyms OK).

**Do:** Add a label to the note, save/re-upload.

## CPT units vs session minutes (+ multi-CPT sum)

**Means:** Timed CPT units must cover length (1 per 15 min). Multiple timed CPTs on one visit are summed. Untimed codes (92507, 92508, 97150, …) can cover with 1 unit.

**Do:** Fix units or times.

## Notes look copy-pasted

**Means:** Two children’s notes normalize to the same text.

**OK:** Same group activity with **different** Progress / Student Response — not copy-paste.

**Do:** Differentiate the note (especially Progress/Response).

## Not found / import caseload / Unknown child / could not read name

**Means:** Name/program id missing from PDF, or child not on caseload.

**Do:** Re-export so name + program id appear; admin imports caseload under Mandates first.

## Group-mandate solo needs no-peer note (#38)

**Means:** Group-mandate child seen individually/alone without a “no peer/partner available” note.

**Do:** Add that phrase. Dual individual+group: normal 1:1 individual visit does not need it; group-tagged with zero peers still does.

## Service type is required

**Means:** Session Service type is blank.

**Do:** Set Service type, save/retry.
