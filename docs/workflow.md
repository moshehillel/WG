# White-glove workflow

Automation syncs ProviderSoft reports into HHA. The bot’s only ProviderSoft interaction is downloading three reports; it does not open individual patient records.

## Reports

| Report | HHA action |
|--------|------------|
| New Opened Cases | Create/update patient, contract, authorization |
| Closed Cases | Update case status / discharge |
| Verified Sessions | Triage: `auto_approve` / `verify_clocking` / `skip`; apply business rules for missing codes |

## Locked business rules

### Early Intervention — ignore (do not send to HHA)

If **program type** is Early Intervention (including values like `Early Intervention`, `EI`), **do not transfer any data to HHA** for that row.

Applies to all three reports when the field is present:

- Opened cases → skip patient/contract/authorization create
- Closed cases → skip status/discharge update
- Verified sessions → skip clocking verify / approve

Detection: `program_type` / `program` contains “early intervention” or equals `EI` (case-insensitive), or an explicit EI flag column.
## Pipeline (AWS)

**Manual only by default** — no automatic daily run. Two ways to start:

1. **Live sessions Function URL** — CloudFormation output `LiveTriggerUrl` (includes `?key=…&confirm=LIVE`). Starts production: `dryRun=false`, `sandbox=false`, **only** `verified_sessions` (API Report) + `caregiver_codes` (visits / pay-code testing). Does **not** download opened/closed/new_services/discharge. Does **not** enable NightlyCaseReports / TuesdaySessions EventBridge rules.
2. **Step Functions console** — Open [PipelineConsoleUrl from stack outputs](https://console.aws.amazon.com/cloudformation) (or run `aws cloudformation describe-stacks --stack-name WhiteGloveStack --query "Stacks[0].Outputs[?OutputKey=='PipelineConsoleUrl'].OutputValue" --output text`), click **Start execution**, input:

```json
{ "runId": "manual-live-sessions", "dryRun": false, "sandbox": false, "reportKinds": ["verified_sessions", "caregiver_codes"] }
```

**Sandbox** (read-only HHA): output `SandboxTriggerUrl`. MFA renew: `MfaDashboardApiUrl` (status / start / complete only — does not start the pipeline).

To enable schedules (nightly cases ~5:00 PM Eastern; Tuesday sessions ~11:00 PM Eastern):

`npm run deploy -w @white-glove/infra -- -c enableNightSchedule=true`

Legacy 06:00 UTC daily: `-c enableDailySchedule=true`

1. **Download** Lambda — production path is the **ECR bot image** (`npm run deploy:aws:live`). Plain `cdk deploy` does not rebuild it; re-enabling schedules only invokes the current image. See [providersoft-bot-aws.md](./providersoft-bot-aws.md).
2. **Parse** Lambda normalizes CSV → JSON artifacts under `runs/{runId}/normalized/`.
3. Parallel HHA sync: opened / closed / sessions processors.
4. **Validate** writes summary + exceptions to S3 and publishes to SNS when needed.

## Hosting

**Serverless (Lambda)** — no always-on server. Each pipeline step runs as an AWS Lambda function invoked by Step Functions; you pay only when a run executes.

## Open questions (client)

- HHA sandbox URL, credentials, API documentation
- Sample exports of the three ProviderSoft reports (final column mapping)
- Service code catalog: meaning, existing in HHA?, create-if-missing?, relation to contracts/auths/visits/billing
- Exact session triage rules (auto-approve vs clocking verify vs never send)
- Preferred schedule timezone (currently 06:00 UTC)
- SNS alert emails (configured: elefkowitz@whiteglovecare.net, moshe@advancedautomations.net)

## Service codes

Placeholder map lives in `packages/shared/src/config/service-codes.ts`. Replace once the client provides the catalog.
