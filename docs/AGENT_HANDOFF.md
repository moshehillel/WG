# White Glove — agent handoff (paste for new project)

**Owner:** Moshe (Advanced Automations) · **Client:** White Glove Care  
**Monorepo:** `https://github.com/moshehillel/WG.git` (local: `custom-projects/White-glove`)  
**AWS account:** `065194293782` · **Region:** `us-east-1` · **Stack:** `WhiteGloveStack`

This repo holds **all** White Glove automation: ProviderSoft→HHA pipeline, TMS (therapist timesheets), HHA SOAP/ENT client, Luna help, SESIS/bids scaffolding, and infra.

---

## Products / surfaces

| Surface | What it is | Live URL / entry |
|--------|------------|------------------|
| **TMS** | Therapist + admin portal: caseload, Frontline/TA PDF upload, sessions, timesheets, SignNow, reports, HHA send | https://tms.whiteglovecare.net (Netlify `whiteglovetms`) · API Lambda `WhiteGloveStack-TmsApiFn07CCEBE7-acrm4XvWrXMQ` |
| **Pipeline** | ProviderSoft report download → parse → HHA sync (opened / closed / sessions) via Step Functions | EventBridge + Lambdas; MFA dashboard for HHA ENT cookies |
| **HHA client** | SOAP + ENT GraphQL to HHAeXchange (CreatePatient, CreateSchedule, ConfirmVisits, UpdatePatientDemographics, …) | Used by TMS transfer + processors |
| **Luna** | In-TMS chatbot for upload/HHA errors (Bedrock + knowledge catalog) | Inside TMS UI |
| **SESIS / Bids** | Separate SESIS staffing/bids path (`packages/sesis-bot`, `apps/sesis-web`, `infra/bids-api`) | Related White Glove ops; not the school TMS core |

**Reports bucket (S3):** `whiteglovestack-reportsbucket4e7c5994-rkpew9rinthi` under `tms/` for TMS artifacts.  
**TMS state:** DynamoDB single-table + S3.  
**No RDS** in this account for White Glove (Security Hub RDS-scan emails are N/A).

---

## Packages (monorepo)

| Package | Role |
|---------|------|
| `@white-glove/shared` | Types, program-types, pay-codes, school billing names, therapy-assignment (Team/Coordinator), exception guidance |
| `@white-glove/hha-client` | Mock + SOAP adapter, CreatePatient, schedule, pay codes, ENT/SPA MFA helpers |
| `@white-glove/processors` | Pipeline handlers: opened, closed, sessions, validate, MFA dashboard API, EVV new-service visits |
| `@white-glove/providersoft-bot` | ProviderSoft report download (Playwright / HTTP) — Lambda container image |
| `@white-glove/tms-db` | MemoryStore model, mandate rules, session PDF parse, reports, pay helpers |
| `@white-glove/tms-api` | Cognito-backed HTTP API: weeks, upload, timesheet, HHA transfer, Luna, admin reports |
| `@white-glove/sesis-bot` | SESIS automation client |
| `apps/tms-web` | Static SPA (vanilla JS) — deploy with **global** `netlify` from `apps/tms-web` only |
| `apps/sesis-web` | SESIS UI SPA |
| `infra/` | CDK (`WhiteGloveStack`, optional Bids stack) + many `deploy-tms-*.mjs` / `deploy-*.mjs` hotfixes |

---

## Pipeline (ProviderSoft → HHA)

**Flow:** Download reports → Parse to S3 normalized JSON → parallel processors → Validate + SNS alerts.

**Reports:** opened_cases, closed_cases, new_services, verified_sessions (API Report), caregiver_codes. `discharge_service` is **paused**.

**Schedules (when enabled):** Nightly cases ~5pm ET; Tuesday sessions ~11pm ET. Prefer live trigger / MFA dashboard over blind CDK redeploys.

**Rules (locked):**
- Early Intervention → never send to HHA
- EVV program types → verify clocking; school/no-EVV → auto-approve path
- Unknown program type / service code → hold + alert
- Pay codes: `{Disc} $rate` or `{Disc} Group $rate`; school duration from **mandate**, not Frontline clock
- Solo group (no peer) → **individual** service code + individual pay (never group bill + individual pay)
- Therapy Team / coordinators: see standing constraints below

**Processors Lambdas (examples):**  
`WhiteGloveStack-SessionsFn37158A11-bkYbevP5YGlD`, `WhiteGloveStack-OpenedFn4D66D9CE-4x7znFUvYknC` (+ closed, validate, download bot image).

---

## TMS (therapist management)

**Therapist tabs:** Add new sessions · Draft · Processed · Archive.  
**Sign / Send timesheet:** Draft only (list row + open week). Removed from Add new sessions (Nov 2026).

**Admin:** children, providers, schools/districts, mandates, weeks, reports (week progress, last service, due dates, HHA transfers, archives), HHA triage, Luna, block-report settings.

**Key behaviors:**
- Frontline / Therapist Activity PDF parse → sessions; paid absence: `Student Not Available: Paid absence.` → attendance `paid_absence` + keep times
- Weekly Session Progress **below mandate** = submitted count (attended + missed + paid absence), not delivered-only
- HHA transfer from locked weeks; skip already confirmed / “Already in HHA” / billed (-401)
- Group vs individual billing/pay from peers + mandate; rewrite group stamp → individual when solo
- CreatePatient uses Therapy Team `10022046` + Billu `84898`; existing charts **keep chart Team** on UpdatePatientDemographics (do not force TeamID overwrite)
- Invalid PayCodeID (-74) errors must **name** the pay code sent (e.g. `OT $62.5`)

**Netlify:** only deploy `apps/tms-web` with installed global `netlify` CLI. Bump `app.js?v=` / `styles.css?v=` on UI ship.

**API code deploy:** `node infra/deploy-tms-*.mjs` (UpdateFunctionCode). Guard `HHA_USE_PRODUCTION=true`. Do not bare `cdk deploy` just to hotfix code (restores old assets / can wipe secrets).

---

## Standing HHA assignment rules (always)

From `.cursor/rules/no-silent-hha-defaults.mdc`:

- **Never** invent coordinator/team/office/branch/location defaults. Missing → stop write.
- **CreatePatient coordinator:** Billu Markowitz **84898** only.
- **CreatePatient team:** Therapy Team **10022046** (office White Glove Community **1025**). Not 2036 (Manager Wendy).
- **Sessions / unscheduled UI:** Billu **84898**, Grace Greenfeld **67321** / **67322**. Never Esty Neuman **68033**. Never Abigail Creech **81103**.
- Coordinator-by-provider-last-name for pipeline assignment: A–Q → Grace, R–Z → Billu; team still Therapy Team for **new** patients.

---

## Docs worth reading first

- `README.md` — setup / deploy
- `docs/workflow.md` — pipeline E2E
- `docs/client-decisions.md` — pay codes, billing names, EVV, schedules
- `docs/luna/*` — Luna error catalog / policy
- `docs/hha-feasibility.md` — SOAP mapping
- This file — agent paste summary

---

## Ops / support notes

- AA Support Admin portal (other Moshe projects): https://www.advancedautomations.net/admin/ — password marked **not a secret** by Moshe for that portal only (`Mg@8456370687`). Use only there.
- Alerts: SNS (+ optional SES). Prefer `npm run cdk:alert-emails` / `deploy-alert-emails.mjs` to add recipients without overwriting Lambdas.
- Wednesday TMS→HHA auto-transfer rule owned by `deploy-tms-hha-auto-transfer.mjs`, not CDK duplicate.

---

## Recent product fixes (Oct–Nov 2026) agents should know

1. Paid absence reader (Frontline) → `paid_absence` + clock kept  
2. Week progress below-mandate counts misses  
3. Keep existing chart Team on demographics update (Rumaysah / Horizon TeamID issues)  
4. Group service + individual pay on old 9/16 visits was pre-fix; new sends enforce pairing; don’t re-write confirmed HHA visits  
5. Send timesheet UI only under Draft  
6. PayCodeID -74 UI/API names the pay code  

---

## How to work in a new Cursor project

1. Clone / open this same repo (`WG` / White-glove).  
2. Keep always-applied rules: no silent HHA defaults; Netlify = `apps/tms-web` only; no commits unless asked (unless user asks to push).  
3. Prefer hot `infra/deploy-*.mjs` for Lambda code; Netlify for SPA.  
4. Production HHA writes are real — dry-run / mock only when explicitly testing.  
5. Prefer absolute paths; PowerShell on Windows.

**Paste this whole file** into the new agent’s first message or project rules so context survives a greenfield chat.
