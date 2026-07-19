# HHA sandbox endpoint probe results (2026-07-16)

**Endpoint:** `https://sandbox1.hhaexchange.com/Integration/ENT/V1.8/ws.asmx`  
**Auth:** PROD companion-guide credentials (`WGCC_613`) against sandbox — **works** (0 auth failures: no `-5` / `-8`).

Raw JSON: [hha-endpoint-probe-results.json](hha-endpoint-probe-results.json)

## Pipeline method status

| Need | Method | Result |
|------|--------|--------|
| Reference | `GetOffices` | PASS |
| Reference | `GetContracts` | PASS |
| Reference | `GetDisciplines` | PASS |
| Reference | `GetCoordinators` | PASS |
| Reference | `GetSourceOfAdmissions` | PASS |
| Close case refs | `GetPatientDischargeTo` | PASS |
| Close case refs | `GetContractDischargeReason` | PASS |
| Find patient | `SearchPatients` | PASS |
| Patient read | `GetPatientDemographics` | PASS (e.g. PatientID `958000`, Agency 613, Office 1025) |
| Patient contracts | `GetPatientContracts` | PASS **with real VisitDate**; empty VisitDate → SOAP fault; wrapped `<PatientContracts>` shape → `-56` |
| Service codes | `GetBillingServiceCodes` | PASS |
| Service codes | `GetContractServiceCode` | Needs valid `ScheduleType` (empty → SOAP fault); still refining |
| Service codes | `GetLinkedContractServiceCodes` | Auth OK; needs valid ScheduleType enum (`-74` so far on Daily/Hourly/…) |
| Authorizations | `SearchPatientAuthorizations` | PASS |
| Authorizations | `GetPatientAuthorizationInfo` | PASS (e.g. AuthID `36052902`) |
| Visits | `SearchVisits` | PASS (omit CaregiverID=0; office search max **1 day**) |
| Visit/EVV read | `GetVisitInfoV2` | PASS with `<ID>` (not `<VisitID>` which falsely returns `-415`) |
| Visit/EVV read | `GetVisitInfoV3` | **`-9` method not authorized** for this app |
| Create patient | `CreatePatient` | Reachable; validation `-73` Invalid DOB on minimal payload |
| Update patient | `UpdatePatientDemographics` | Reachable; validation `-70` |
| Add placement | `AddPatientContract` | **Succeeded** with minimal payload on Patient `958000` (sandbox write works) |
| Discharge/close | `UpdatePatientContract` | Reachable; requires `DischargeToID` (`-315`) |
| Create auth | `CreatePatientAuthorization` | Reachable; requires `Period` (`-315`) |
| Update auth | `UpdatePatientAuthorization` | Reachable (validation error) |
| Schedule | `CreateSchedule` / `UpdateSchedule` | Reachable; `ScheduleType` required but allowed values still unknown |
| Approve | `ConfirmVisits` | Reachable; needs valid ReasonCode — lookup API `-9` unauthorized |
| Approve | `ConfirmVisitsV2` | Reachable; TimesheetRequired validation |

## Discovered sandbox IDs

- Offices: `2259`, `2933`, `7362`, `13511`, `15453`, `16039`, `1025`
- Sample patient: `958000` (ALFREDA JONES) — placements `7440866` (Metroplus / PCA Hourly U1), `7444699` (RN Supervision)
- Sample authorization: `36052902`
- Coordinator sample: `81103`
- Contract catalog sample: `69168` (and many more from `GetContracts`)

## Client fixes applied after probe

- `GetPatientContracts`: flat params + **required** `VisitDate`
- `SearchVisits`: do not send `CaregiverID=0`; optional `officeId`
- `GetVisitInfoV2`: send `<ID>` (not `<VisitID>`)

## From Provider Guide v3.38 (PDF)

Source: `HHAeXchange Web Service API v 3.38 (1).pdf` (and the similarly named guide PDF).

### `CreateSchedule` / service-code helpers

| Field | Allowed values (guide) |
|-------|------------------------|
| **ScheduleType** | `Non-Skilled` or `Skilled` (**required**) |
| **VisitType** | `Daily Variable`, `Weekly Variable`, `No Schedule`, `Daily Fixed` (default if omitted) |
| **ScheduleStartTime / EndTime** | `HHMM` (e.g. `0900`), office timezone — **not** `09:00` |
| **ScheduleDurationHours/Minutes** | Required only for Daily/Weekly Variable / No Schedule — **do not send** for Daily Fixed |
| **IsScheduleTemporary** | `Yes` / `No` |

`GetContractServiceCode` / `GetLinkedContractServiceCodes` use the same **ScheduleType** values (`Non-Skilled` / `Skilled`). Verified PASS on sandbox after applying guide values.

### `GetVisitInfoV2`

Guide documents visit detail including Timesheet Required/Approved (`YES`/`NO`) and TasksPerformed / POCTaskCode. Sandbox works with `<VisitInfo><ID>…</ID></VisitInfo>`.

### `GetVisitEditReasonActionTaken`

Documented (returns `VisitEditReasonID` + action-taken info for a VisitId). Our app still gets **`-9` not authorized** on sandbox — need HHA to enable for App Name `WGCC_613`.

### `ConfirmVisits`

**Not documented** in Provider Guide v3.38 write/method chapters (only present on live ASMX). ReasonCode/ActionCode almost certainly map to `VisitEditReasonID` / action IDs from `GetVisitEditReasonActionTaken`.

### Sandbox retest after guide (2026-07-16)

- `GetContractServiceCode` + `Non-Skilled` → **PASS** (12 codes for patient 958000 / contract 10410)
- `GetLinkedContractServiceCodes` + `Non-Skilled` → **PASS**
- `CreateSchedule` with guide values + caregiver + pay code → **PASS** — created VisitID **`1298399661`** (patient 958000, 2026-07-22 0900–1300)

### Still need from HHA / White Glove

1. Enable `GetVisitEditReasonActionTaken` (or send ReasonCode/ActionCode list) so `ConfirmVisits` can finish.
2. Optionally enable `GetVisitInfoV3` if EVV detail fields beyond V2 are required.

## Visit / EVV breakthrough (broad probe)

- **`GetVisitInfoV2` works** when the payload uses `<VisitInfo><ID>{visitId}</ID></VisitInfo>`.  
  Using `<VisitID>` returns `-415 Invalid VisitID for current agency` (misleading).
- Working sample: Visit `1282693446` (Office 1025, Patient `24521304` MILDRED BELLEZZE, Caregiver `4380022`, schedule 09:00–13:00 on 2026-07-10).
- **`GetVisitInfoV3`**: still `-9` not authorized for this app.
- **`ConfirmVisits`**: auth OK; ISO datetimes parse; requires valid **ReasonCode** (+ ActionCode). Lookup method `GetVisitEditReasonActionTaken` returns **`-9` not authorized** — need HHA to enable it or provide reason/action code list.
- **`CreateSchedule`**: requires a non-empty `ScheduleType` whose allowed values are still unknown (common strings all `-74`).
- Extra methods that **pass**: `GetBranches`, `GetNurses`, `GetLanguages`, `GetMissedVisitReasons`, `GetCaregiverDocumentType`, `GetCaregiverReferralSources`, `SearchCaregivers`.

