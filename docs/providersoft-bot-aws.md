# ProviderSoft bot → AWS (ECR container Lambda)

The download step runs a **Docker image** from ECR (`white-glove/providersoft-bot`). EventBridge schedules only *invoke* that Lambda — they never rebuild the image.

## Critical: schedules vs bot image

| Action | Rebuilds bot image? |
|--------|---------------------|
| Re-enable nightly / sessions schedules | **No** — uses whatever image the download Lambda already points at |
| `cdk deploy` (processors / stack flags) | **No** — does not run CodeBuild |
| `npm run deploy:aws:live` / `bot:deploy:aws -- --local` | **Yes** — CodeBuild → ECR → retarget Lambda |

**When you turn schedules back on, you do not need another bot update** if today’s fixed image is already on the download Lambda (`npm run bot:check-fresh` passes). You only need a bot rebuild if someone redeployed an older image or shipped bot source without `deploy:aws:live`.

That Aug 21 vs Aug 24 gap happened because `bot:deploy:aws` was a **separate manual step** from normal CDK deploys.

## Standard live deploy (use this)

Always rebuild + tag the bot when shipping ProviderSoft download changes:

```powershell
cd C:\Users\Moshe\Desktop\custom-projects\White-glove
npm run deploy:aws:live
# same as: npm run bot:deploy:aws -- --local
```

This:

1. CDK-deploys stack (live bot on, **schedules stay off**)
2. Zips local `providersoft-bot` + `shared`, CodeBuild builds/pushes ECR
3. Tags image `latest` **and** `src-<fingerprint>`
4. Pins the download Lambda to the new image **digest**

Then verify:

```powershell
npm run bot:check-fresh
```

## Enable schedules (only when asked)

```powershell
npm run schedules:enable
```

Runs `bot:check-fresh` first; **fails** if local bot/shared sources do not match the ECR `src-*` tag. Does not rebuild the image — it only flips EventBridge on when the image is current.

## Do not rely on plain CDK for bot code

```powershell
# Updates processors / flags only — NOT the Playwright/HTTP bot image
npm run deploy -w @white-glove/infra -- -c providerSoftLiveBot=true ...
```

## GitHub bootstrap path

`npm run bot:deploy:aws` without `--local` downloads **GitHub `main`**. Push bot fixes before using that path, or prefer `deploy:aws:live` (local zip).

## Go-live checklist

- [ ] `npm run deploy:aws:live` succeeded
- [ ] `npm run bot:check-fresh` OK
- [ ] Manual Step Functions run with dateRanges / empty-CSV OK
- [ ] Only then `npm run schedules:enable` (when explicitly requested)

## Useful report IDs

- Gluck open: `4566` (Gender: column)
- New service: `4567` / rebuilt ids via env
- API Report: `4026`
