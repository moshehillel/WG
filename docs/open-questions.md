# Open questions for the client

See **[client-decisions.md](./client-decisions.md)** for answered rules (EVV programs, schedule, alerts, pay codes, caregiver codes).

## Still need from client

1. **Additional alert emails** — Send comma-separated list for SNS (each person confirms AWS subscription once).

2. **Discharge “Home” vs HHA label** — API has no literal “Home”; we mapped client **Home** → HHA **self/family/friend** (`HHA_DISCHARGE_TO_ID=198`). Confirm this is correct.

3. **Unmatched Service Types (13 SI/ABA variants)** — Not found in HHA billing codes; rows using these **error** until mapped. See `UNMATCHED_SERVICE_TYPES` in `service-codes.ts`.

4. **HHA clock → visit linking** — **Partial (pipeline only).** ProviderSoft verified-sessions pipeline already implements `findPendingCall` → `linkClockToVisit` (`ConfirmVisitsEVV`) → clock compare → approve. Live sandbox still needs usable ReasonCode/ActionCode pairs (`GetVisitEditReasonActionTaken` often `-9` on sandbox unless `HHA_REASON_LOOKUP_URL` / visit id is configured). Not a TMS product gap.

## Done recently

5. **Caseload DOB (TMS → HHA CreatePatient)** — **Done (Sep 2026).** Final WG caseload includes `Student BirthDate`; import maps to `student.dob` and CreatePatient uses it. School address → patient address remains wired; schools show red/incomplete until calendar + address are complete.

## School calendar → mandate over-checks (done)

Admin school calendar (first/last day + off days) is now passed into every live `checkMandatesForWeek` path (week GET, import/upload, session save, week submit). Cycle / school-day windows use Mon–Fri minus off days; weekends never count; densest N school-day window over-check hard-blocks.

## Schedule (confirmed for implementation)

| When | What | Mode |
|------|------|------|
| **Every night 2:00 AM Eastern** | Gluck open + closure | Live |
| **Monday night 2:00 AM Eastern** | All reports (incl. API Report) | **Dry-run** — email alerts only, no HHA writes |
| **Tuesday night 2:00 AM Eastern** | Verified sessions (API Report) | Live |

Enable in AWS: `npm run deploy -w @white-glove/infra -- -c enableNightSchedule=true`

Bot **never runs daytime** — night batch only.

## Resolved via prod API lookup (Jul 2026)

| Item | Result |
|------|--------|
| **Program Type → ContractID** | **63/63** → `contract-map.ts` |
| **Service Type → ServiceCodeID** | **47/60** sample types → `service-codes.ts` |
| **DischargeToID for Home** | **198** (`self/family/friend`) |

## Confirmed (no longer open)

| Item | Decision |
|------|----------|
| **Provider & Student Selection** | Multi-school picker is required after provider sign-in. Providers/Children remain separate nav lists (A–Z letter layout removed). Child/provider **detail** tabs (ProviderSoft-style) shipped Sep 2026. |
| **CPSE session import** | **Done (Sep 2026, Moshe).** CPSE portal session reports **are** Therapist Activity Output PDFs (`Therapist_Activity_Output…` sample/fixture — already imported). Same `/week/upload-sessions` as Frontline. Do **not** say “need a different CPSE sample” or “CPSE not built.” |
| **AI activity + student response** | **Done (Sep 2026, Moshe).** Covered by duplicate-note blocking (notes must be unique per child; copy-paste blocked) plus existing AI / required-note lockers. No separate unfinished feature. |
| **Early Intervention** | Skip all rows — never send to HHA. |
| **Session triage by program** | EVV → verify clocking; no-EVV → direct entry; `program-types.ts`. |
| **Unknown / unmatched service type** | **Error + SNS alert** — do not proceed to HHA. |
| **Discharged To** | Default **Home**; closure reason **case termination**. |
| **Pay codes** | Discipline + $rate (e.g. `OT $72`, `OT Group $34`). Monday preview flags missing pay codes. |
| **Caregiver codes** | Separate PS report; lookup by Provider Name; alert if missing. |
| **Weekly review** | Monday night dry-run; Tuesday night live sessions; other reports nightly. |
| **Report UserReportIds** | Open **4526**, closure **4527**, discharge **4528**, API **4026**, caregiver codes **4541**. |

Deploy:

```powershell
npm run deploy -w @white-glove/infra -- -c "alertEmails=elefkowitz@whiteglovecare.net,moshe@advancedautomations.net" -c enableNightSchedule=true
```

Manual run: **PipelineConsoleUrl** in CloudFormation outputs. Optional input: `{ "runId": "manual-…", "dryRun": true, "reportKinds": ["opened_cases","closed_cases","verified_sessions"] }`.