# HHAeXchange sandbox feasibility (Enterprise SOAP V1.8)

**Environment policy: sandbox only.** Do not call production (`app.hhaexchange.com`) until White Glove / HHA explicitly green-lights go-live.

Sandbox endpoint: `https://sandbox1.hhaexchange.com/Integration/ENT/V1.8/ws.asmx`  
Credentials source: Companion Guide (Sandbox) — App Name / Agency ID are non-secret identifiers; App Secret and App Key must live only in local `.env` or Secrets Manager (never in git).  
API behavior reference: Enterprise Provider Guide v3.38 (docs the product; sandbox is the only allowed runtime for now).

## Auth status

**Blocked:** every `GetOffices` / `GetContracts` / `SearchPatients` call returns:

- HTTP 400
- `ErrorID = -5`
- `ErrorMessage = Invalid application key.`

Tried:

- App Key as printed in the companion guide (Base64 UTF-16LE blob)
- Decoded UTF-16LE plaintext form of that key
- Key with embedded newline as in the PDF wrap
- Wrong App Name / App Secret variants

Whitespace check (per client request, 2026-07-14 evening):

- Re-extracted key characters directly from the PDF and stripped every whitespace character; Base64 length and padding decode cleanly — no spaces were hiding in the key.
- Retested all-clean key plus more encodings (plaintext, lower-case, no dashes, UTF-8 re-Base64, no padding). Every variant returns `ErrorID -5, Invalid application key.`
- Probe scripts (`packages/hha-client/scripts/*.mjs`) read credentials from env only.

Conclusion: the key is whitespace-free and self-consistent, but sandbox still rejects it — **App Key is not active** (expired, rotated, or never provisioned on sandbox1). Need HHA / White Glove to re-issue a working sandbox App Key before write tests.

### Proof that App Name + Secret are valid and only the App Key fails

The API returns two distinct errors depending on which credential is wrong:

| Sent | ErrorID | Message |
|------|---------|---------|
| Correct secret + guide App Key (any encoding/swap) | `-5` | Invalid application key. |
| Corrupted App Secret (Base64-encoded, or App Key value pasted into the secret field) | `-8` | Invalid application name/secret key. |

Since corrupting the secret changes the error from `-5` to `-8`, validation is two-stage: App Name + App Secret pass first (ours do), then the App Key check fails. Swapping secret and key in both directions was also tested — no combination authenticates. The App Key for Agency 613 must be re-issued/activated by HHAeXchange.

### Alternate auth methods also tried

Enterprise SOAP `AppParams` only has `AppName` / `AppSecret` / `AppKey` — there is no second SOAP credential scheme. Still tried every alternate transport:

| Method | Result |
|--------|--------|
| SOAP 1.1 sandbox | `-5` Invalid application key |
| SOAP 1.2 sandbox | `-5` Invalid application key |
| Lowercase `/integration/...` sandbox URL | `-5` Invalid application key |
| ASMX HTTP form POST (`/GetOffices`) | HTTP 500 (not a supported nested Authentication shape) |
| OAuth2 on sandbox `/identity/connect/token` using AppName/Secret as client_id/secret | `invalid_client` (EVV Aggregator OAuth is a different product) |

(An earlier exploratory hit on production also returned `-5`; **further work stays sandbox-only.**)

Probe script: `packages/hha-client/scripts/alt-auth-probe.mjs`.

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
