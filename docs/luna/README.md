# Luna — White Glove TMS support assistant

## Where Luna lives

| Layer | Path |
| --- | --- |
| Chat + handoff (API) | `packages/tms-api/src/luna.ts` |
| Knowledge pack (prompt) | `packages/tms-api/src/luna-knowledge.ts` |
| Routes | `POST /support/luna/chat`, `POST /support/luna/handoff` in `packages/tms-api/src/router.ts` |
| UI | `apps/tms-web` — `#lunaRoot` in `index.html`, styles, `app.js` Luna section |
| Hosting notes | `apps/tms-web/HOSTING.txt` (Luna section) |
| Deploy (Lambda code) | `infra/deploy-tms-luna-knowledge.mjs` (and prior `deploy-tms-luna-*.mjs`) |

Luna is **not** Intercom/Zendesk. It is an in-app OpenAI chatbot on the TMS API Lambda, with optional guest chat on the login screen.

## Ticket path

1. User chats with Luna; on escalate Luna sets `action: "handoff"`.
2. UI shows name + email fields → **Send to Moshe** (`POST /support/luna/handoff`).
3. SES emails `LUNA_SUPPORT_EMAIL` (default `moshe@advancedautomations.net`) with contact block, summary, and transcript.
4. Confirmation shown to the user uses **their** contact email only (not the internal inbox).

No separate ticket database — email **is** the ticket.

## Updating knowledge

1. Edit `packages/tms-api/src/luna-knowledge.ts` (source of truth for the live prompt).
2. Keep this folder’s markdown twins in sync (`ERROR_CATALOG.md`, `HOW_TO.md`, `CONVERSATION_POLICY.md`).
3. Run `packages/tms-api` tests.
4. Deploy TmsApi: `node infra/deploy-tms-luna-knowledge.mjs` (or full CDK when stacking other changes).
5. Do **not** change `HHA_USE_PRODUCTION` for Luna deploys.

## Verify

- Open TMS SPA → click Luna FAB (login or signed-in).
- Say: “I’m getting an HHA error” → Luna should ask you to paste the exact text.
- Paste e.g. `No HHA pay code rate for session` → Luna should explain missing dollar rates + provider rate fields.
- Ask how to upload a PDF → short how-to from the pack.
- Say still stuck → handoff bar → name/email → ticket email arrives at support inbox.
- Guest: same chat paths without Cognito (rate limited).
