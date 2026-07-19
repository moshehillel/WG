# Open questions for the client

Use this checklist in the next call. Answers unstick sandbox wiring and business rules.

1. **HHA sandbox App Key** — re-issue / activate (Auth currently fails with ErrorID -5).
2. **Sample reports** — One real export each of New Opened Cases, Closed Cases, Verified Sessions (CSV/XLSX).
3. **Service codes** — Catalog, which exist in HHA already, create-if-missing, and how they bind to contracts / authorizations / visits / billing.
4. **Session triage rules** — Exact conditions for auto-approve vs verify-clocking vs never send to HHA.
5. **Schedule** — Preferred daily run time and timezone (stack default: 06:00 UTC).
6. **Alerts** — Email address for SNS exception digests (`cdk deploy -c alertEmail=...`).

## Confirmed rules

- **Early Intervention:** if program type is Early Intervention / EI, ignore the row — do not send any data to HHA (opened cases, closed cases, and verified sessions).
