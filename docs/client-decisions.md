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

**Current subscribers:** `elefkowitz@whiteglovecare.net`, `moshe@advancedautomations.net`

## Sample reports — column adequacy

| Report | Enough for automation? | Gaps |
|--------|------------------------|------|
| **Gluck open** | **Mostly yes** | **Program Type → ContractID**; **Service Type → HHA service code** |
| **Gluck closure** | **Yes** with Home discharge default | Set `HHA_DISCHARGE_TO_ID` once |
| **Discharge service** | **Yes** with same discharge default | |
| **API Report** | **Yes** | Pay Rate + Service Type for pay code; Provider Name for caregiver lookup |
| **Caregiver codes** | **Yes** | UserReportId **4541** (network capture Jul 2026) |

## Still need from client

1. **Program Type → HHA ContractID**
2. **Service Type → HHA ServiceCodeID** catalog
3. **Schedule confirmation** — open/close frequency, timezone, Monday preview hour, Tuesday noon ET
4. **HHA clock → visit linking** — pending HHA response

