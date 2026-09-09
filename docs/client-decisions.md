# Client decisions (Jul 2026)

Record of answers from White Glove. Drives config in `program-types.ts`, schedules, and alerts.

## Session triage (verified sessions / API Report)

| Rule | Action |
|------|--------|
| **Early Intervention** | **Skip** — never send to HHA |
| **Program types marked EVV** (see `program-types.ts`) | **Verify clocking** — match ProviderSoft session times to HHA EVV before confirm |
| **Program types marked no EVV** (school districts, BOE, etc.) | **Auto-approve / direct entry** — no EVV match required |
| **Unknown program type** | Hold + alert until added to config |
| **Unknown Service Type** (no HHA exchange code mapping) | **Alert** on open case and on session row; do not silently skip |

Program type list source: client email Jul 2026 (EVV vs “no evv” suffix on each payer/program name).

## Pay codes (updated Sep 2026)

HHA pay codes are titled **discipline + $rate**, or **discipline + Group + $rate** for group visits.

**Duration for pay (mandate, not Frontline):** School 30/42/45 (and hourly) buckets come from the **matching mandate’s authorized duration** (caseload RS Duration). Do **not** round Frontline/PDF begin–end minutes to the nearest pay bucket. Example: clock ran **40 minutes** but mandate is **30** → use **30-min rate** (not 42).

**Solo group rule:** Group-tagged session with no other attended/makeup peers in the same caregiver clock window → bill **individual** rate / pay code (`OT $62.5`), not group — still using the mandate’s duration bucket.

### Group size / overlap (Sep 2026)

| Rule | Behavior |
|------|----------|
| **Fewer than mandate groupSize** | Always allowed (e.g. 2 of 3 OK) |
| **More than mandate groupSize** | Blocked |
| **Small Group / Group** (no numeric size) | Stored **groupSize = 2** (client: small group = fewer than 3); overlap still caps legacy null at 2 |
| **Group-mandate seen individually** | Individual pay; note should say **no peer available**; treated as **individual for overlap** (later peer in same window blocked) |
| **Group↔group share window** | Only when both sessions are **group-tagged** (Group / 2:1 / 3:1 / 4:1) |

| Source | Field | Example |
|--------|-------|---------|
| Service Type / TMS discipline | discipline prefix | `OT School` → **OT** |
| Pay Rate / TMS provider pay | applicable rate | `62.5` → **$62.5** |
| Eval sessions | provider `payRateEval` | `95` → **OT $95** |
| HHA individual | Pay code name | **OT $62.5** |
| HHA group | Pay code name | **OT Group $34** |

Examples to create in HHA (match rate decimals as stored): `OT $62.5`, `OT $70`, `PT $70`, `OT Group $34`, `SLP $52.5` (HHA may also list ST for SLP — resolver accepts both).

Implementation: `packages/shared/src/config/pay-codes.ts` — `buildPayCodeName(serviceType, payRate, { group? })`.

Resolve to HHA `PayCodeID` via `GetCaregiverPayCodes` / office reference table at schedule time. Missing pay code → **hard-fail that session**.

## TMS school billing service codes (Sep 2026 — for billing)

Create these **exact** ServiceCode names under each school contract (lookup is case-insensitive). Per discipline **OT / PT / SLP**:

| Kind | Exact name pattern | Examples |
|------|--------------------|----------|
| Eval | `{Disc} School eval` | `OT School eval`, `PT School eval`, `SLP School eval` |
| ~30 min individual | `{Disc} school 30` | `OT school 30`, … |
| ~42 min individual | `{Disc} school 42` | `OT school 42`, … |
| ~45 min individual | `{Disc} school 45` | `OT school 45`, … |
| ~60 min / other individual | `{Disc} school 60` | `OT school 60`, … |
| ~30 min group | `{Disc} school group 30` | `OT school group 30`, … |
| ~42 min group | `{Disc} school group 42` | `OT school group 42`, … |
| ~45 min group | `{Disc} school group 45` | `OT school group 45`, … |
| ~60 min / other group | `{Disc} school group 60` | `OT school group 60`, … |
| Additional | `{Disc} additional services` | `OT additional services`, … |

**Duration bucket:** from the **matching mandate’s authorized duration** (same as TMS provider pay) — nearest of 30 / 42 / 45 within **3 minutes** of that mandate length; otherwise **60**. Do **not** derive the bucket from Frontline session clock length.

**Kind detection:** `additionalServiceType=eval` or “eval” in Service Type → School eval; other additional kinds (progress report, consultation, meetings, paid absence) → additional services; else school + duration. **Group vs individual** comes from the mandate (`ratioGroup` / group size), not from whether the session had present peers (solo-group pay may still use individual rates).

**Caseload import naming (Sep 2026):** On mandate upsert from caseload, store `billingServiceName` = `{Disc} school {bucket}` (individual) or `{Disc} school group {bucket}` (group) from discipline + RS Duration + ratio. Keep Related Service (`serviceType`) for therapist display. HHA week transfer prefers the stored name; falls back to compute-from-mandate for older rows (and rewrites legacy group rows that were stamped without “group”). Eval / additional are not caseload mandates.

Implementation: `packages/shared/src/config/school-billing-codes.ts`. Missing service code → **hard-fail that session**.

## Caregiver codes (confirmed Jul 2026)

Separate ProviderSoft saved report: **“caregiver codes”**.

| Column | Use |
|--------|-----|
| Provider Name | Match API Report **Provider Name** |
| Caregiver Code | HHA caregiver code (e.g. `WGC-35595`) |

- Bot downloads report when `PROVIDERSOFT_REPORT_CAREGIVER_CODES_ID` is set (capture from PS Network tab).
- Keep last export on disk; if provider missing, re-download report and retry.
- If still not found by normalized name → **alert** (`unknown_caregiver`).
- Sample: `docs/samples/caregiver-codes.csv`

Implementation: `packages/shared/src/config/caregiver-codes.ts`.

## Closure / discharge (confirmed Jul 2026)

| Field | Default |
|-------|---------|
| **Discharged To** | **Home** (`GetPatientDischargeTo` → set `HHA_DISCHARGE_TO_ID`) |
| **Reason** | **Case termination** |

## Weekly review schedule (confirmed Jul 2026)

| When | What |
|------|------|
| **Every night 2:00 AM Eastern** | Gluck open + closure — live HHA sync |
| **Monday night 2:00 AM Eastern** | Dry-run all reports — flag missing service codes, contract IDs, pay codes, caregiver codes. **Email alert only** — no HHA writes. |
| **Tuesday night 2:00 AM Eastern** | Live verified sessions (API Report) after staff fix mappings flagged Monday. |

Unknown or **unmatched** Service Types → **error** (SNS alert), not silent skip.

Enable: `cdk deploy -c enableNightSchedule=true`

Preview must flag new Service Types **and** pay codes that fail the discipline+rate rule.

## Opened cases — missing / unknown service codes

- When opening a case, if **Service Type** has no mapping to an HHA exchange code → **SNS alert** with case ID and code (implemented via `unknown_service_code` / `missing_service_code` exceptions).

## Schedule (client preference)

| Pipeline | Timing | Notes |
|----------|--------|-------|
| **Open + close cases** | **Nightly 2:00 AM Eastern** | Every day |
| **Verified sessions (API Report)** | **Tuesday 2:00 AM Eastern** | Live after Monday preview |
| **Weekly preview** | **Monday 2:00 AM Eastern** | Dry-run all reports |
| **AWS deploy** | `enableNightSchedule=true` | No daytime runs |

## Alert emails

**Primary path:** SNS email subscriptions (From: Amazon-managed **AWS Notifications** / no-reply style). No White Glove domain or DKIM required.

**Optional:** SES HTML + CSV when a verified From identity works (`ALERT_ALWAYS_SNS=true` still publishes SNS every time).

**Current subscribers:** `elefkowitz@whiteglovecare.net`, `moshe@advancedautomations.net`, `ggreenfeld@whiteglovecare.net` (Grace Greenfeld), `alowy@whiteglovecare.net` (Aliza Lowy), `gfriedman@whiteglovecare.net` (Gila Friedman)

### TMS HHA failure digest (SES)

Daily **~6:00 PM Eastern** (EventBridge `22:00 UTC`) email to **`mgluck@whiteglovecare.net`** listing that day’s HHA transfer failures (missing pay/service code, CreatePatient fail, and other `hhaStatus=failed` / transfer errors).

- **Subject:** `HHA errors for YYYY-MM-DD`
- **Body:** provider, child, week, session date/time, error, and a link to `https://wgfront.netlify.app/?hhaWeek=<id>` (opens admin dashboard, highlights the week, triage + **Send to HHA / Retry HHA**)
- **No failures that day → no email**
- **SES sandbox:** recipient must be a verified identity (mgluck was verified for timesheet email). From address is `TMS_FROM_EMAIL` / `alertFromEmail` (`alerts@advancedautomations.net`).
- **Job flag:** Lambda invoke `{ "tmsJob": "hha-error-digest" }` (also `POST /internal/hha-error-digest` with `TMS_INTERNAL_KEY`)

## Sample reports — column adequacy

| Report | Enough for automation? | Gaps |
|--------|------------------------|------|
| **Gluck open** | **Mostly yes** | **Program Type → ContractID**; **Service Type → HHA service code** |
| **Gluck closure** | **Yes** with Home discharge default | Set `HHA_DISCHARGE_TO_ID` once |
| **Discharge service** | **Yes** with same discharge default | |
| **API Report** | **Yes** | Pay Rate + Service Type for pay code; Provider Name for caregiver lookup |
| **Caregiver codes** | **Yes** | UserReportId **4541** (network capture Jul 2026) |
| **New service** (existing child) | **Yes** — see below | Filter **Service Begin Date** in PS; save as **"new service"** |

## Gluck open — one open per child

ProviderSoft Gluck open is a **Service Report**: intake date selects the case, then the CSV lists **every service period** on that case (same Program Id can appear many times; same Service Type with different Service Begin Dates = different auth periods, not bot duplicates).

**Bot rule:**
1. **One Gluck open per child (`caseId`)** — create/update the HHA patient once and process one primary service line (prefer begin date closest to Date of Intake).
2. **Extra intake-aligned lines** (Service Begin within ~14 days of intake) → processed on the **new service** path (find existing child, add auth/placement).
3. **Historical periods** (older begin dates on the Gluck export) → **skipped** — not re-opened from Gluck; genuinely new begins should come from the **new service** report.

## New service report (existing child, new service line)

Use when the child already exists in ProviderSoft/HHA but a **new Service Type** row starts (not a new intake).

**ProviderSoft setup** (Service Report type, UserReportId **4544**)

1. **Report name:** `new service` (bot link name must match).
2. **Step 1:** Service Report (not Children).
3. **Step 2 — include these columns:**

| # | Column | Why |
|---|--------|-----|
| 1 | Child's Name | Patient match |
| 2 | Program Id | Case ID |
| 3 | Date of Birth | HHA patient |
| 4 | Provider Name | EVV placeholder caregiver (CreateSchedule) |
| 7–9 | Child's Address / City / State | HHA address |
| 10–11 | Primary Contact Name / Phone | HHA contact |
| 14 | Child's Zip Code | HHA address |
| 20 | **Service Type** | HHA service code mapping + pay-code discipline prefix |
| 36–37 | **Service Begin Date / Service End Date** | Contract + auth dates; bot filters on Begin Date |
| 65 | **Authorization Number** | HHA authorization |
| 75 | **Program Type** | Contract ID mapping |
| — | **Pay Rate** | Required for EVV programs: Service Type + Pay Rate → HHA PayCode (e.g. OT + 72 → **OT72**) on placeholder CreateSchedule |
| 118 | Real DOB (For school Cases) | School cases only |

4. **Step 3 — filter:** leave empty; bot sets **Service Begin Date** at download time (today → today).
5. **UserReportId:** `4544` → `PROVIDERSOFT_REPORT_NEW_SERVICES_ID=4544`.

**Pipeline:** merged with Gluck open → same HHA flow (`upsertPatient` → contract → authorization). One row per service line; same Program Id can appear multiple times.

**Skip** closure, billing, mandate, SC/ABA, and referral columns unless you need them for manual review only.

## Still need from client

1. **Program Type → HHA ContractID**
2. **Service Type → HHA ServiceCodeID** catalog
3. **Schedule confirmation** — open/close frequency, timezone, Monday preview hour, Tuesday noon ET
4. **HHA clock → visit linking** — partial: pipeline code exists (`ConfirmVisitsEVV`); sandbox needs reason/action codes (see open-questions)

## Due dates (school-scoped)

Progress / annual / reeval due dates belong on the **school**, not each child. Each school can have an **array of assignments** (`kind` / Type, `dueOn`, optional `notes`). Notes cover school-wide context or a specific child (e.g. “only for child X”). Nags email providers with mandates at the school plus admins.

In the UI these are labeled **Progress report due dates** (Type: Progress / Annual / Reevaluation; Due Date; Notes).

**Migration:** legacy per-student due dates lift to the student’s school when unambiguous (same school + kind + dueOn). Rows with no school, or conflicting dueOn values for the same school+kind from legacy student rows, are dropped — we do not invent dates. Modern school-scoped rows (already `schoolId`) are preserved as multiple assignments.

## Student DOB (TMS caseload)

DOB on the student record is imported from caseload when present and recommended for HHA (session/patient transfer). Final WG export **Related Service Details by School (WG)** includes **Student BirthDate** — mapped onto `student.dob` and passed into HHA CreatePatient. Admins can still edit DOB on the child detail screen.

**HHA CreatePatient DOB (Sep 2026 — Moshe):** **Done.** Caseload column `Student BirthDate` → student → CreatePatient `dateOfBirth`. No fake DOB; blank DOB still fails CreatePatient until filled.

## HHA patient create from TMS (school address)

When TMS creates an HHA patient (`resolveHhaPatientId` → `upsertPatient` / CreatePatient last resort):

| Field | Source |
|-------|--------|
| **Address / City / State / Zip** | **School** address (admin school detail) |
| **DOB** | Caseload **Student BirthDate** / student record — no fake DOB |

Admins enter school address on the school screen. CreatePatient still requires address + DOB when the child is not already in HHA.

## School setup incomplete (calendar + address)

A school is **incomplete** (shown **red** in admin Schools list + detail, with a banner / Schools nav badge) until **both**:

1. **Calendar** is saved (first day, last day, and/or off days), and  
2. **Full address** is filled (street, city, state, zip) for HHA CreatePatient.

Message examples: needs calendar and address; needs calendar; needs address.

## Caseload RS Provider (TMS)

RS Provider on caseload import **must match an existing TMS therapist** (First Last / Last, First). Agency labels (“White Glove”, “White, Glove”) and unmatched names are **hard errors** — that row is skipped; do **not** save a mandate with an empty provider and do **not** invent providers. Schools/students still create from valid rows. There is **no Default provider** on import.

## Group sessions (TMS overlap + pay)

| Rule | Behavior |
|------|----------|
| **Small group** | Fewer than 3 students (caseload “Group” / “Small Group” with no numeric size → **groupSize 2**) |
| **Fewer than mandate groupSize** | Always allowed |
| **More than mandate groupSize** | Blocked on import / save |
| **Group-tagged with ≥1 present peer** | Group pay rate / `OT Group $rate` |
| **Solo group (0 present peers) or individual tag on group-mandate child** | Individual pay; **hard locker** — note must say **no peer was available** (or clear equivalent); treated as **individual for overlap** (later same-time note → overlap error) |

## Processed weeks & 14-day locker (Sep 2026; Madison review update)

| Rule | Behavior |
|------|----------|
| **Processed Sessions (provider)** | Signed/locked (paid) sessions only — Session date, Attended status, Start/End time, Pay rate. No week wording. |
| **Pending Sessions (provider)** | Draft / reopened / submitted workbench; reload control says **Reload sessions**. |
| **Awaiting signature (submitted)** | Provider sessions fully locked — cancel approval to return to draft before any edit/import/add |
| **Signed / locked** | Provider sessions fully locked — admin reopen required before edits |
| **New sessions while locked** | Providers may **not** add/import until cancel (submitted) or admin reopen (signed/locked). Admins may still override. Age locker (14 days) still applies when unlocked. |
| **Makeup** | Requires unused miss on that date **or** leftover makeup-auth capacity; **no mandate → hard block** |
| **Cycle / school-day mandates** | Skip **weekly** over-check; enforce densest **N school-day** window instead (calendar off-days when set; else Mon–Fri) |
| **Monthly mandates** | Manual period option; over-check uses calendar month |

## Admin portal (TMS web)

| Item | Status |
|------|--------|
| **Frontline / Therapist Activity / CPSE-portal PDF → sessions** | **Done.** CPSE portal session reports **are** Therapist Activity Output PDFs (e.g. `Therapist_Activity_Output…` — already imported). Same `/week/upload-sessions` as Frontline. Do **not** say CPSE is missing or ask for a different sample. |
| **Admin Frontline upload** | No week/calendar picker — sessions attach by DOS (14-day locker). |
| **Generate timesheet** | On provider detail |
| **Additional services** | On provider detail |
| **Providers / Children lists** | Separate nav items; A–Z letter-tab layout removed per Madison (Sep 2026). |
| **Child detail tabs** | ProviderSoft-style: Basic info (default) · Mandates (+ progress-report dues) · Sessions · Timesheet · Student files |
| **Provider detail tabs** | Basic info · Pay rates · Caseload · Sessions (import / timesheet / additional services) · Upload reports · Internal notes |
| **Yellow import block toggle** | Admin setting `yellowWarningsBlockImport` (default **ON**). When OFF, yellow/warn note flags do not fail the whole PDF import; red/hard still all-or-nothing. |
| **Provider Processed Sessions** | Signed/locked (paid) sessions only — columns: Session date, Attended status, Start/End time, Pay rate. No week wording. |
| **Provider Pending Sessions** | Draft / reopened / submitted workbench; **Reload sessions** (not “reload week”). |
| **Provider detail sessions** | Session list (not Weeks picker) |
| **Mandate edit** | Admin can edit uploaded mandates (PATCH `/admin/mandates/:id`) |
| **Provider school selection** | Required picker after sign-in when provider has multiple schools |
| **AI activity + student response** | **Done (Sep 2026, Moshe).** Satisfied by unique-per-child notes (copy-paste blocked) + existing AI / required-note lockers — no separate open gap. |

## School calendar (TMS)

Admins enter per school: **first day**, **last day**, and **off days** (holidays/breaks). **Wired into live mandate over-checks** (import / save / submit / week view): `checkMandatesForWeek` resolves each child’s school calendar. Cycle windows = Mon–Fri within year bounds, excluding admin off days; weekends never count; densest N school-day window **hard-blocks** when over Freq. Empty calendar → weekday-only default **with an explicit warning** (week/import/save/admin): `No school calendar for [School] — falling back to Mon–Fri (weekends excluded; no holiday off-days).`

**PDF upload (Sep 2026):** Admin can upload a text-based school calendar PDF; the system extracts closed/holiday dates (and first/last day when labeled) into the calendar form for review, then save. Scanned image-only PDFs are not supported (same text-layer limit as session PDFs). Best with district calendars that list holidays in text (e.g. “Thanksgiving Recess Nov 27–28, 2025”).

## HHA clock → visit linking

| Path | Status |
|------|--------|
| ProviderSoft verified sessions (`process-sessions`) | **Implemented:** pending Call Dashboard clock → `linkClockToVisit` (`ConfirmVisitsEVV`) → EVV time match → approve |
| Sandbox reason/action codes | **Partial blocker:** `GetVisitEditReasonActionTaken` often unauthorized (`-9`); needs enablement or `HHA_REASON_LOOKUP_URL` + known VisitID |
| TMS week transfer (school billing) | Schedule + `approveVisit` — school/no-EVV programs do not require clock link |

## Frontline / Therapist Activity / CPSE weekly PDF upload (TMS)

Supported sources on `POST /week/upload-sessions`: **Frontline** RS Session Notes and **Therapist Activity Output** PDFs. Moshe (Sep 2026): **CPSE portal session reports are Therapist Activity Output** (fixture/sample: `Therapist_Activity_Output…`) — CPSE session import is **done**; do **not** ask for another CPSE sample or call it unbuilt.

Requires entities to **already exist**:
- PDF Service Provider must match the logged-in therapist’s provider profile (when present on the PDF).
- Child must already exist (from caseload) — unknown child → error; **no auto-create**.
- PDF school must match the child’s school when both are known (clear mismatch → error).

## Cognito MFA (TMS) — Sep 2026

| Item | Decision |
|------|----------|
| **Who** | **All Cognito logins** — therapists (providers) and admins. Same enroll-on-login + challenge path. |
| **Pool MFA** | **OPTIONAL** (not REQUIRED) so admins can turn enforcement off without a Cognito lock-in |
| **Require MFA** | App setting `requireMfa` (**default ON**). Users without TOTP / email MFA / passkey must enroll before entering the app |
| **Allow SMS MFA** | **OFF** (Moshe decision). `allowSmsMfa` default false; SPA enroll UI does not offer SMS or phone capture |
| **Primary method** | Authenticator app (TOTP) — always available; **no per-message fee** |
| **Email OTP MFA** | Cognito native `EMAIL_OTP` via SES (`advancedautomations.net` / TMS From). Cognito emails the code on login challenge after enroll |
| **Passkeys / Windows Hello** | Cognito WebAuthn with user verification. Enroll after sign-in; login via **USER_AUTH + WEB_AUTHN** (passwordless first factor that satisfies MFA). Not a second factor after password |
| **Trust this device** | Cognito device tracking + remembered device after MFA; checkbox on MFA challenge |
| **Turn MFA off (org)** | Discreet admin control only: long-press site footer → Advanced security, or Security (MFA) → Advanced (admins). Not a dashboard toggle. Saving **Require MFA OFF** also clears Cognito `PreferredMfaSetting` / MFA enrollments pool-wide so login is password-only (OPTIONAL pool still challenges enrolled users otherwise). |
| **Turn MFA off (user)** | Security (MFA) → Advanced → turn off own MFA only when org does not require it (clears TOTP / email OTP; deletes passkeys separately) |
| **UI language** | English ↔ Español toggle (login + app); preference in `localStorage` `tmsLang` |

Implementation: `infra/lib/tms.ts` (pool), `packages/tms-db` settings, `packages/tms-api` `/admin/settings` + `/me`, `apps/tms-web` login/enroll UX + i18n.

## Timesheet principal e-sign (SignNow)

| Rule | Behavior |
|------|----------|
| **Vendor** | **SignNow** (Moshe, Sep 2026) — **not** DocuSign |
| **Send timesheet** | SES email + branded PDF to the school signer until a SignNow REST API is wired |
| **UI copy** | “Awaiting SignNow”, SignNow / email hints — never DocuSign |
| **Manual admin Sign** | Disabled (410); principal signs via SignNow; completion auto-locks → HHA |
| **Legacy code** | Old DocuSign REST helper removed from the send path; CDK `TmsDocuSignSecret` id retained for stack stability only |

## TMS HHA environment (sandbox until go-live)

Live `TmsApiFn` uses **real** SOAP (`HHA_USE_MOCK=false`) against **sandbox** (`HHA_USE_PRODUCTION=false`). Same `HhaSecret` creds; URL forced to `sandbox1.hhaexchange.com`.

**Flip to production later (CDK):** in `infra/lib/tms.ts` set `HHA_USE_PRODUCTION: 'true'` and `HHA_ALLOW_PRODUCTION: 'true'`, then `cdk deploy`.

