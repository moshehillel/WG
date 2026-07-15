# White-glove

ProviderSoft → HHA automation on **AWS Lambda** (TypeScript).

The pipeline downloads three ProviderSoft reports (New Opened Cases, Closed Cases, Verified Sessions), then creates/updates patients, contracts, authorizations, visit approvals, and closed-case status in HHA.

## Packages

| Package | Role |
|---------|------|
| `@white-glove/shared` | Types, Zod schemas, service-code map, S3 key helpers |
| `@white-glove/providersoft-bot` | Playwright login + report download (Lambda container) |
| `@white-glove/processors` | Parse, rules, HHA sync handlers, validate/SNS |
| `@white-glove/hha-client` | HHA API interface + mock + HTTP scaffold |
| `@white-glove/infra` | AWS CDK stack (S3, Secrets, DynamoDB, SFN, EventBridge, SNS) |

## Prerequisites

- Node.js 20+
- AWS account + credentials configured (`aws configure` or env)
- Docker (for ProviderSoft Lambda image build/deploy)
- AWS CDK CLI (via workspace: `npm run cdk`)

## Setup

```bash
npm install
npm run build
npm test
```

Copy `.env.example` to `.env` and fill credentials for local runs.

## Local ProviderSoft download

Stub CSVs (no live login):

```bash
npm run local:download -w @white-glove/providersoft-bot -- --stubs
```

Live UI (requires env credentials and correct selectors for their portal):

```bash
npm run local:download -w @white-glove/providersoft-bot
```

Upload stubs/live files to S3:

```bash
set REPORTS_BUCKET=your-bucket
npm run local:download -w @white-glove/providersoft-bot -- --stubs --upload
```

## Deploy

1. Put real ProviderSoft / HHA values into the secrets after first deploy (console or CLI).
2. Optionally set alert email: `cdk deploy -c alertEmail=you@example.com`
3. From repo root:

```bash
npm run build
npm run cdk -w @white-glove/infra -- bootstrap   # once per account/region
npm run cdk -w @white-glove/infra -- deploy
```

Until HHA sandbox is ready, processors use `HHA_USE_MOCK=true`. Set `HHA_USE_MOCK=false` and populate the HHA secret when API access arrives.

For pipeline dry-runs without a real ProviderSoft UI, set the download Lambda env `PROVIDERSOFT_USE_STUBS=true`.

## Manual Step Functions start

```json
{
  "runId": "2026-07-14-manual-1",
  "dryRun": false
}
```

## Docs

- [docs/workflow.md](docs/workflow.md) — end-to-end flow
- [docs/open-questions.md](docs/open-questions.md) — checklist for the client call
- [docs/hha-feasibility.md](docs/hha-feasibility.md) — HHAeXchange SOAP mapping + sandbox auth status

### HHA sandbox smoke

**Sandbox only** — do not point `HHA_BASE_URL` at production until go-live is approved.

```bash
set HHA_BASE_URL=https://sandbox1.hhaexchange.com/Integration/ENT/V1.8/ws.asmx
set HHA_APP_NAME=...
set HHA_APP_SECRET=...
set HHA_APP_KEY=...
npm run sandbox:smoke -w @white-glove/hha-client
```
