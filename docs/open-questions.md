# Open questions for the client

See **[client-decisions.md](./client-decisions.md)** for answered rules (EVV programs, schedule, alerts).

## Still need from client

1. **Service Type → HHA exchange code** — Full catalog (ProviderSoft `Service Type` / CPT → HHA code). Alerts fire on unknown codes; mapping must be maintained in `service-codes.ts`.
2. **Program Type → HHA ContractID** — e.g. Extended Home Care Therapy → ContractID from `GetContracts`.
3. **Discharged To (default)** — `UpdatePatientContract` needs `DischargeToID`. Confirm agency default (e.g. “Home”) or add column to closure report.
4. **Schedule — confirm times** — Open/close: **once or twice daily**? Which clock times + **timezone**? Sessions: **Tuesday 12:00** — confirm noon **Eastern**?
5. **Additional alert emails** — Send comma-separated list for SNS (each person confirms AWS subscription once).
6. **Weekly code preview** — Confirm **Tuesday 11:00 dry-run + Tuesday 12:00 live** for API Report (preview lists new unknown codes only).

## Confirmed (no longer open)

| Item | Decision |
|------|----------|
| **Early Intervention** | Skip all rows — never send to HHA. |
| **Session triage by program** | EVV programs → verify clocking; no-EVV programs → direct entry; list in `program-types.ts`. |
| **Unknown service code on open** | Alert (SNS) — do not silently proceed. |
| **HHA credentials** | Prod App Name/Secret/Key against sandbox URL. |
| **ProviderSoft bot user** | `MGLUCK2`. |
| **Alert emails (current)** | `elefkowitz@whiteglovecare.net`, `moshe@advancedautomations.net`. |
| **Report UserReportIds** | Open **4526**, closure **4527**, discharge **4528**, API **4026**. |
| **Sample CSV exports** | In `docs/samples/`; parsers in `parse-reports.ts`. |
| **AWS run mode** | Manual trigger only (no auto schedule until times confirmed). |

Deploy / update alerts:

```powershell
npm run deploy -w @white-glove/infra -- -c "alertEmails=elefkowitz@whiteglovecare.net,moshe@advancedautomations.net"
```

Manual pipeline run: see **PipelineConsoleUrl** in CloudFormation stack outputs.
