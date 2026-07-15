# White-glove workflow

Automation syncs ProviderSoft reports into HHA. The bot’s only ProviderSoft interaction is downloading three reports; it does not open individual patient records.

## Reports

| Report | HHA action |
|--------|------------|
| New Opened Cases | Skip Early Intervention; create/update patient, contract, authorization |
| Closed Cases | Update case status |
| Verified Sessions | Triage: `auto_approve` / `verify_clocking` / `skip`; apply business rules for missing codes |

## Pipeline (AWS)

1. EventBridge (daily 06:00 UTC) starts Step Functions.
2. **Download** Lambda (Playwright container) logs into ProviderSoft, downloads reports, writes to S3 `runs/{runId}/raw/`.
3. **Parse** Lambda normalizes CSV → JSON artifacts under `runs/{runId}/normalized/`.
4. Parallel HHA sync: opened / closed / sessions processors (mock client until sandbox is wired).
5. **Validate** writes summary + exceptions to S3 and publishes to SNS when needed.

## Hosting

Runs in the client AWS account (Lambda + Step Functions). You create the account; CDK deploys the stack.

## Open questions (client)

- HHA sandbox URL, credentials, API documentation
- Sample exports of the three ProviderSoft reports (final column mapping)
- Service code catalog: meaning, existing in HHA?, create-if-missing?, relation to contracts/auths/visits/billing
- Exact session triage rules (auto-approve vs clocking verify vs never send)
- How Early Intervention is identified on Opened Cases
- Preferred schedule timezone (currently 06:00 UTC)
- SNS alert email for exceptions

## Service codes

Placeholder map lives in `packages/shared/src/config/service-codes.ts`. Replace once the client provides the catalog.
