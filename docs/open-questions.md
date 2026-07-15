# Open questions for the client

Use this checklist in the next call. Answers unstick sandbox wiring and business rules.

1. **HHA sandbox** — URL, credentials, API documentation (patients, contracts, auths, visits, clocking, approvals, case close).
2. **Sample reports** — One real export each of New Opened Cases, Closed Cases, Verified Sessions (CSV/XLSX).
3. **Early Intervention** — Which column/value marks EI on opened cases?
4. **Service codes** — Catalog, which exist in HHA already, create-if-missing, and how they bind to contracts / authorizations / visits / billing.
5. **Session triage rules** — Exact conditions for auto-approve vs verify-clocking vs never send to HHA.
6. **Schedule** — Preferred daily run time and timezone (stack default: 06:00 UTC).
7. **Alerts** — Email address for SNS exception digests (`cdk deploy -c alertEmail=...`).
