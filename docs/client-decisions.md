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

## Opened cases — missing / unknown service codes

- When opening a case, if **Service Type** has no mapping to an HHA exchange code → **SNS alert** with case ID and code (implemented via `unknown_service_code` / `missing_service_code` exceptions).
- Client asked for a **weekly preview** before verification transfer: run a **dry-run / review report** the **day before** Tuesday transfer to surface **new service codes** so staff can mirror them in HHAeXchange. **Not built yet** — proposed: Tuesday 11:00 preview (alert-only), Tuesday 12:00 live transfer.

## Schedule (client preference)

| Pipeline | Preferred timing | Notes |
|----------|------------------|-------|
| **Open + close cases** | Daily or **twice daily** | Client to confirm one option + **timezone** (assume US/Eastern unless stated) |
| **Verified sessions (API Report)** | **Tuesday at 12:00** | Likely noon Eastern; confirm AM/PM and timezone |
| **Current AWS deploy** | **Manual only** | No auto schedule until client confirms times |

To enable after confirmation:

```powershell
# Example: daily open/close at 6am ET + separate Tuesday session job (needs second state machine or report-kind split)
npm run deploy -w @white-glove/infra -- -c enableDailySchedule=true
```

## Alert emails

**Current subscribers:** `elefkowitz@whiteglovecare.net`, `moshe@advancedautomations.net`

**Client asked:** “Shall I send you emails of people to get the notice?” → **Yes.** Send a comma-separated list; we add via:

```powershell
npm run deploy -w @white-glove/infra -- -c "alertEmails=addr1@...,addr2@..."
```

Each address must **confirm** the AWS SNS subscription email once.

## Sample reports — column adequacy

Samples in `docs/samples/` (from ProviderSoft).

| Report | Enough for automation? | Gaps |
|--------|------------------------|------|
| **Gluck open** | **Mostly yes** for patient identity + service window | Need **Program Type → HHA ContractID** table; **Service Type → HHA billing/service code** catalog; authorization # often implicit — confirm column |
| **Gluck closure** | **Partial** | Has closure date + program ID; still need **DischargeToID** default for HHA discharge API |
| **Discharge service** | **Partial** | Service-level end/discharge dates; same **DischargeTo** default |
| **API Report** | **Yes for session flow** | Has session date/times, provider, supplier #, program type, service type; caregiver match via **SearchCaregivers(Provider Name)** or unscheduled visit EVV |

**No new CSV columns required** for the core flow if we maintain mapping tables in config. Optional additions that would reduce risk:

- Explicit **authorization number** on Gluck open (if not always in Service Type)
- **Discharged To** on closure report (or confirm single agency-wide default)

## Still need from client

1. **Service Type → HHA code** catalog (e.g. `OT CHHA EXTENDED` → HHA service/billing code).
2. **Program Type → HHA ContractID** (from `GetContracts` / payer setup).
3. **Discharged To** default ID for closures.
4. **Schedule confirmation** — twice daily vs once for open/close; timezone; Tuesday 12 = noon ET?
5. **Additional alert email addresses** (comma-separated list).
6. **Twice-daily open/close** — if twice daily, specify both times (e.g. 8:00 and 17:00 ET).
