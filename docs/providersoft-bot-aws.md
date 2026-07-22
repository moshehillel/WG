# ProviderSoft bot → AWS (Playwright production path)

The daily pipeline will run the **Playwright bot in a container Lambda** (Chromium included). Until go-live, the deployed download step still uses **stub CSVs** so AWS works without hitting ProviderSoft.

## What is already prepared

| Piece | Status |
|--------|--------|
| Local bot (`train:bot`) | Working (Gluck open proven) |
| Retries (3×) + HTTP backup | In code |
| `Dockerfile` (Playwright + Lambda RIC) | Ready |
| CDK flag `providerSoftLiveBot` | Ready (default **false**) |
| Live `handler.ts` (stubs or Playwright) | Ready |
| Lambda Chromium launch flags | Ready |

## Current deploy (safe default)

```powershell
cd C:\Users\Moshe\Desktop\custom-projects\White-glove
npm run deploy -w @white-glove/infra -- --require-approval never
```

- Zip Lambda + `PROVIDERSOFT_USE_STUBS=true`
- **No Docker required**

## When ready for production bot (not yet)

Needs Docker Desktop running, then:

```powershell
# 1) Put real ProviderSoft creds in Secrets Manager (ProviderSoftSecretArn from stack outputs)
#    JSON: { "baseUrl": "https://web2.providersoftllc.com/WhiteGloveCommunityCareInc", "username": "...", "password": "..." }

# 2) Deploy Playwright image (still stubs until you flip the next flag)
npm run deploy -w @white-glove/infra -- -c providerSoftLiveBot=true --require-approval never

# 3) After local train:bot proves all reports + parsers are ready:
npm run deploy -w @white-glove/infra -- -c providerSoftLiveBot=true -c providerSoftUseStubs=false --require-approval never
```

## Go-live checklist (do not flip stubs off until all are done)

- [ ] Gluck open, closure, discharge, API Report all download via `train:bot`
- [ ] `UserReportId` for closure + discharge set (env / Lambda config)
- [ ] Real CSV column mapping in `parse-reports.ts`
- [ ] ProviderSoft secret filled (not `CHANGE_ME`)
- [ ] HHA secret + mock off when write path is approved
- [ ] SNS `alertEmail` configured
- [ ] Docker deploy with `providerSoftLiveBot=true`
- [ ] One manual Step Functions run with `providerSoftUseStubs=false`
- [ ] Only then leave daily schedule on live mode

## Useful IDs already known

- Gluck open: `4526`
- API Report: `4026`
