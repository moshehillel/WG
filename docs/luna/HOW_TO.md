# How to use White Glove TMS (Luna how-to)

Source of truth for the live bot: `packages/tms-api/src/luna-knowledge.ts`.

## PDF upload

1. Open Entry (therapist) or admin provider → week.
2. Upload Frontline session-notes or Therapist Activity Output PDF (text PDF only; scanned images not supported).
3. Review parsed rows; fix red errors; save.

Import caseloads under **Mandates** first if children are “Not found”.

## Fix upload issues

Read each error line (child · date · message). Common fixes: signature, CPT units, missed Frontline reason, school match, service type, copy-paste notes, caseload import, no-peer note for group solo. Re-export after signing/editing notes. Custom Word/PDF on Entry is an **attachment only** (not parsed).

## Sign timesheet

Complete sessions → **Sign timesheet** on the draft week / Entry section 3 → confirm provider signature before send.

## Send timesheet

Sign first (Send stays blocked until signed) → **Send timesheet** → branded PDF goes to school/principal signer. Track on Draft / Sent; resend signer email if needed.

## Send to HHA / triage (admin)

Locked/signed week as required → admin warning triangle → **HHA Triage** → fix per error → **Send to HHA** retry. Do not change `HHA_USE_PRODUCTION` or secrets.

## Add mandate (Discipline, Makeup-Weekly)

Mandates → child → **Add mandate manually** → Discipline (OT/PT/SLP), frequency/times, dates. Use Makeup-Weekly when configured for weekly makeups without a linked miss. Makeup notes may need the missed date.

## Additional services (Documentation, No child)

Session form → Additional service type (Documentation, Eval, etc.) → child may be **No child**. Fill times carefully (provider additional hourly rules).

## Last service report

Admin → **Last service** → optional provider filter → table or download `last-service.xlsx`.
