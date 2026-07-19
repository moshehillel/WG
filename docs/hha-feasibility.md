# HHAeXchange sandbox feasibility (Enterprise SOAP V1.8)

**Environment policy: sandbox only.** Do not call production (`app.hhaexchange.com`) until White Glove / HHA explicitly green-lights go-live.

Sandbox endpoint: `https://sandbox1.hhaexchange.com/Integration/ENT/V1.8/ws.asmx`  
Credentials source: Companion Guide (Sandbox) — App Name / Agency ID are non-secret identifiers; App Secret and App Key must live only in local `.env` or Secrets Manager (never in git).  
API behavior reference: Enterprise Provider Guide v3.38 (docs the product; sandbox is the only allowed runtime for now).

## Auth status

### Sandbox — WORKING with PROD credentials (2026-07-16)

White Glove confirmed the production App Name / Secret / Key may be used against the sandbox URL. Verified:

- `GetOffices` → `ErrorID=0`, offices returned
- Full pipeline endpoint probe: **0 auth failures** (`-5` / `-8`)

See [hha-endpoint-probe.md](hha-endpoint-probe.md) for per-method results.

Keep `HHA_ALLOW_PRODUCTION=false` and the sandbox base URL until go-live is approved.

### Historical: sandbox-only companion App Key was invalid

Earlier sandbox-guide App Key returned `ErrorID=-5 Invalid application key` for every encoding. Superseded by using PROD credentials on the sandbox endpoint.

### Production — credentials work (2026-07-15)

The **PROD** companion guide credentials authenticate successfully against `https://app.hhaexchange.com/integration/ENT/V1.8/ws.asmx` when sent exactly as printed (`ErrorID = 0`). Do **not** write to production until explicit go-live.

## Pipeline → API mapping

| Automation need | HHAeXchange method(s) | Feasible once auth works? |
|-----------------|----------------------|---------------------------|
| Find / create patient | `SearchPatients`, `GetPatientDemographics`, `CreatePatient`, `UpdatePatientDemographics` | Yes |
| Add / update contract (placement) | `GetContracts`, `GetPatientContracts`, `AddPatientContract`, `UpdatePatientContract` | Yes |
| Create / update authorization | `CreatePatientAuthorization`, `UpdatePatientAuthorization`, `SearchPatientAuthorizations`, `GetPatientAuthorizationInfo` | Yes |
| Service codes | `GetContractServiceCode`, `GetBillingServiceCodes`, `GetLinkedContractServiceCodes` only (v3.38) | **Read only** — no create API |
| Locate / schedule visit | `SearchVisits`, `GetVisitInfoV2`/`V3`, `CreateSchedule`, `UpdateSchedule` | Yes |
| Verify clocking / EVV | `GetVisitInfoV3` returns `VisitStartTime`/`EndTime`, `EVVStartTime`/`EVVEndTime`, Timesheet Required/Approved | Yes (read/compare) |
| Approve visit | Live ASMX exposes `ConfirmVisits` / `ConfirmVisitsV2` / `ConfirmVisitsEVV`; **not documented** in v3.38 Provider Guide write list | Likely yes via Confirm* (confirm after App Key works) |
| Close / discharge case | `UpdatePatientContract` (`UpdateDischargeDate` / discharge reason) | Yes (no dedicated “close case” API; discharge on contract) |
| Validate transfer | `GetPatientDemographics`, `GetVisitInfoV2`, `SearchPatients` | Yes |

## Gaps / risks (not auth)

1. **CreatePatient** needs many office-required fields (address, coordinator, etc.) not just name/DOB — map from ProviderSoft report columns + `GetOffices`.
2. **CreateSchedule** needs caregiver, discipline, contract, times — Verified Sessions report must include enough (or search existing visits only).
3. **ConfirmVisits** may require reason/action codes and duties depending on office setup; validate against a real visit after App Key works (present on ASMX, absent from v3.38 guide TOC).
4. Closed cases map to **contract discharge** (`UpdatePatientContract` / `UpdateDischargeDate`), not a separate case entity.
5. Companion guide dated **8/9/2023** — sandbox credentials may simply be obsolete.
6. **New service codes cannot be created via API** (v3.38): only `GetBillingServiceCodes` / `GetContractServiceCode` / `GetLinkedContractServiceCodes`. `UpdateServiceCode` on `UpdatePatientContract` only changes which *existing* code is on a placement.

## API guide cross-check: v3.38 (Jan 2026)

Read `HHAeXchange Web Service API v 3.38.pdf` (242 pages). Confirms:

- Same credential model (App Name / Secret / Key) and same `-5` / `-8` error IDs
- Patients, contracts, authorizations, schedules: create/update supported as previously mapped
- Service codes: reference-table **get** only
- Clocking validation: `GetVisitInfoV3` exposes schedule/visit/EVV times + timesheet flags
- Rate limit note: max **200 calls/minute** per provider

## What we added in repo

- `@white-glove/hha-client` SOAP client + `SoapHhaClientAdapter`
- `npm run sandbox:smoke -w @white-glove/hha-client` (needs `HHA_APP_NAME`, `HHA_APP_SECRET`, `HHA_APP_KEY`)
- Method catalog: [hha-methods.txt](hha-methods.txt)

## Ask White Glove / HHA

1. Confirm / re-issue sandbox App Key for the registered White Glove app (App Name from companion guide).
2. Provide one known sandbox PatientID + VisitID for clocking/confirm dry-runs.
3. Share required CreatePatient / CreateSchedule field list for their office config.
