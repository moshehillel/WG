# Open questions for the client

Use this checklist in the next call. Answers unstick business rules and go-live.

## Still need from client

1. **Service codes** — Catalog: ProviderSoft `Service Type` → HHA code; which exist in HHA already; how they bind to contracts / authorizations / visits / billing.
2. **Program Type → HHA ContractID** — Mapping table (e.g. Extended Home Care Therapy, Americare Certified → `GetContracts` ContractID). API lists contracts; client defines which payer/program each row uses.
3. **Discharged To (default)** — `UpdatePatientContract` requires `DischargeToID` (`GetPatientDischargeTo`). CSVs have closure/discharge **dates** but not destination. Need a **default** for API closures (e.g. always “Home” / “Case closed”), or a small scenario → ID map.
4. **Session triage rules** — Exact conditions for auto-approve vs verify-clocking vs never send to HHA.
5. **Schedule** — Preferred daily run time and timezone (stack default: 06:00 UTC).
6. **4th report / “existing case + new service”** — Confirm business rule and whether it is a separate pipeline step.
7. **EI skip rule on real data** — Confirm Early Intervention rows should never go to HHA (samples are mostly EI).
8. **Office defaults for new patients** — Confirm coordinator, branch, team, location, admission source (or accept agency defaults from sandbox patient 1025 setup).
9. **Provider → HHA CaregiverID** — Rule for API Report: match `Provider Name` and/or `Supplier Number` via `SearchCaregivers`?

## Confirmed (no longer open)

| Item | Decision |
|------|----------|
| **HHA credentials** | Production App Name / Secret / Key works against sandbox URL — separate sandbox App Key not required. |
| **ProviderSoft bot user** | `MGLUCK2` (automation account). |
| **Alert emails** | `elefkowitz@whiteglovecare.net`, `moshe@advancedautomations.net` (both SNS subscribers). |
| **Report UserReportIds** | All four captured via live login (`npm run capture:reports`): open **4526**, closure **4527**, discharge **4528**, API **4026**. See `docs/providersoft-report-network.json`. |
| **Sample CSV exports** | Received: Gluck open, closure, discharge service, API Report — in `docs/samples/`; column mapping in `parse-reports.ts`. |

Deploy alerts:

```powershell
npm run deploy -w @white-glove/infra -- -c "alertEmails=elefkowitz@whiteglovecare.net,moshe@advancedautomations.net"
```

## Locked business rules

- **Early Intervention:** if program type is Early Intervention / EI, ignore the row — do not send any data to HHA (opened cases, closed cases, and verified sessions).
