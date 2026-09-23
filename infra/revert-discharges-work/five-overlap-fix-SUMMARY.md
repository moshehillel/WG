# Fix five overlap kids — live results

**Run:** 2026-09-17T01:42Z (SOAP inventory + act)  
**Strategy:** For each of the five: live `GetPatientContracts` (PatientID-only). If mistaken NEW `#8596xxx` still ACTIVE → `UpdatePatientContract` discharge. If OLD still discharged → try clear DischargeDate. **No** `AddPatientContract`. **No** `discharge_service` re-enable.

**Prior note confirmed:** Downs / Helena / Arshad / Navelgas already had OLD ACTIVE and NEW gone. Picciuto PatientID still returns agency `-56`.

---

## Per-case

| # | Patient | CaseId | PatientID | Before OLD | Before NEW | Action taken | After OLD | After NEW | UI needed? |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | Edmund Picciuto | `258272446` | `26372249` | **unavailable** (`-56`) | **unavailable** | Blind discharge NEW attempted → `-56`; SearchPatients Status=`All`/`Discharged`/DOB → **0 hits** | unavailable | unavailable | **YES — HHA UI only** |
| 2 | Fiona Downs | `258270803` | `24865860` | `#8045831` ACTIVE | `#8596095` gone | none needed | ACTIVE | gone | no |
| 3 | Helena Galeanocarvajal | `04725821` | `23012434` | `#6897698` ACTIVE | `#8596089` gone | none needed | ACTIVE | gone | no |
| 4 | Hooria Arshad | `02891799` | `22854608` | `#6812439` ACTIVE | `#8596053` gone | none needed | ACTIVE | gone | no |
| 5 | Karlandrew Navelgas | `258267421` | `22680255` | `#6711683` ACTIVE | `#8596097` gone | none needed | ACTIVE | gone | no |

### What we discharged
- **None** of the five still had an ACTIVE mistaken NEW at live check. No NEW placements were discharged in this pass.

### What still needs UI
- **Edmund Picciuto only.** SOAP `GetPatientContracts` / `GetPatientDemographics` / `UpdatePatientContract` on PatientID `26372249` → ErrorID **`-56`** (“Patient ID is an invalid for current Agency”). `SearchPatients` with Status=`All` (name, admission, MR, DOB 09/02/2009) returns no PatientID. ENT SPA token in `.env` is expired (401), so UI API path also blocked without a fresh MFA login.
- Earlier today (~20:08Z) the same PatientID still returned OLD `#8522217` discharged `2026-09-15` + NEW `#8596091` ACTIVE. Something changed agency visibility since then — coordinator must find him in **HHA ENT UI** (Status=All/Discharged), then: clear Discharge Date on **OLD `#8522217`**, discharge **NEW `#8596091`** if still present.

---

## Sibling leftover check (read-only)
Porter / Asunto / Rolon — same mess family; quick inventory only:

| Patient | OLD | NEW leftover |
|---|---|---|
| Roy-Al Porter | `#7909108` ACTIVE | `#8596092` gone |
| Michael Asunto | `#7935330` ACTIVE | `#8596094` gone |
| Caleb Rolon | `#7802393` ACTIVE | `#8596093` gone |

No sibling leftover NEW still active — no extra discharges.

---

## Artifacts
- `fix-five-overlap-kids.mjs` — apply script for the five
- `fix-five-overlap-results.json` / `.md` — machine + table output
- `probe-picciuto-deep.mjs` + `picciuto-deep-probe.json` — Picciuto search matrix
- `probe-picciuto-discharge-retry.mjs` + `picciuto-discharge-retry.json` — blind NEW discharge with DischargeToID=341 still `-56`
- `check-sibling-leftovers.mjs` + `sibling-leftover-check.json`

Generated: 2026-09-17 (ops pass)
