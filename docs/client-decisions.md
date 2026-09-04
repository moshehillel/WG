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

## Pay codes (confirmed Jul 2026)

HHA pay codes are titled **discipline + pay-rate number** (e.g. **OT72** = OT discipline, $72 rate).

| Source | Field | Example |
|--------|-------|---------|
| ProviderSoft API Report | **Service Type** (discipline prefix) | `OT CHHA EXTENDED` → **OT** |
| ProviderSoft API Report | **Pay Rate** | `72.0000` → **72** |
| HHA | Pay code name | **OT72** |

Implementation: `packages/shared/src/config/pay-codes.ts` — `buildPayCodeName(serviceType, payRate)`.

Resolve to HHA `PayCodeID` via `GetCaregiverPayCodes` / office reference table at schedule time.

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

**Current subscribers:** `elefkowitz@whiteglovecare.net`, `moshe@advancedautomations.net`, `ggreenfeld@whiteglovecare.net` (Grace Greenfeld)

## Sample reports — column adequacy

| Report | Enough for automation? | Gaps |
|--------|------------------------|------|
| **Gluck open** | **Mostly yes** | **Program Type → ContractID**; **Service Type → HHA service code** |
| **Gluck closure** | **Yes** with Home discharge default | Set `HHA_DISCHARGE_TO_ID` once |
| **Discharge service** | **Yes** with same discharge default | |
| **API Report** | **Yes** | Pay Rate + Service Type for pay code; Provider Name for caregiver lookup |
| **Caregiver codes** | **Yes** | UserReportId **4541** (network capture Jul 2026) |
| **New service** (existing child) | **Yes** — see below | Filter **Service Begin Date** in PS; save as **"new service"** |

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
| 4 | Provider Name | Reference |
| 7–9 | Child's Address / City / State | HHA address |
| 10–11 | Primary Contact Name / Phone | HHA contact |
| 14 | Child's Zip Code | HHA address |
| 20 | **Service Type** | HHA service code mapping |
| 36–37 | **Service Begin Date / Service End Date** | Contract + auth dates; bot filters on Begin Date |
| 65 | **Authorization Number** | HHA authorization |
| 75 | **Program Type** | Contract ID mapping |
| 118 | Real DOB (For school Cases) | School cases only |

4. **Step 3 — filter:** leave empty; bot sets **Service Begin Date** at download time (today → today).
5. **UserReportId:** `4544` → `PROVIDERSOFT_REPORT_NEW_SERVICES_ID=4544`.

**Pipeline:** merged with Gluck open → same HHA flow (`upsertPatient` → contract → authorization). One row per service line; same Program Id can appear multiple times.

**Skip** closure, billing, mandate, SC/ABA, and referral columns unless you need them for manual review only.

## Still need from client

1. **Program Type → HHA ContractID**
2. **Service Type → HHA ServiceCodeID** catalog
3. **Schedule confirmation** — open/close frequency, timezone, Monday preview hour, Tuesday noon ET
4. **HHA clock → visit linking** — pending HHA response

## Due dates (school-scoped)

Progress / annual / reeval due dates belong on the **school**, not each child. One due date (per kind) applies to that school’s caseload. Nags email providers with mandates at the school plus admins.

In the UI these are labeled **Progress report due dates** (kinds remain progress / annual / reeval).

**Migration:** legacy per-student due dates lift to the student’s school when unambiguous (same school + kind + dueOn). Rows with no school, or conflicting dueOn values for the same school+kind, are dropped — we do not invent dates.

## Student DOB (TMS caseload)

DOB on the student record is **optional for now** but **recommended for HHA** (session/patient transfer). Caseload Excel/CSV imports Program ID / Program Type / Date of Birth when those columns exist; the current WG “Related Service by serviceschool” export does not include them — leave blank and no import block. Admins can enter DOB on the child detail screen.

## Caseload RS Provider (TMS)

RS Provider on caseload import **must match an existing TMS therapist** (First Last / Last, First). Agency labels (“White Glove”, “White, Glove”) and unmatched names are **hard errors** — that row is skipped; do **not** save a mandate with an empty provider and do **not** invent providers. Schools/students still create from valid rows. There is **no Default provider** on import.

## Frontline weekly PDF upload (TMS)

`POST /week/upload-sessions` requires entities to **already exist**:
- PDF Service Provider must match the logged-in therapist’s provider profile (when present on the PDF).
- Child must already exist (from caseload) — unknown child → error; **no auto-create**.
- PDF school must match the child’s school when both are known (clear mismatch → error).

