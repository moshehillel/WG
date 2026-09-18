# Mistaken discharge remediation — final (REACTIVATE OLD ONLY)

**Run remediated:** `886d6a26-a989-a9d4-9e89-74f7a9bfeaef` discharge_service (7 successes) + 3 meeting overlap kids = **10**.

**Strategy (user-confirmed):** clear/reactivate **original** placements only. **No new contracts** in this pass. Earlier mistaken `AddPatientContract` placements are documented below (already created; none created in this pass).

**Technical result:** HHA SOAP `UpdatePatientContract` can **set** a discharge date but **cannot clear** it via API (empty date → XSD fault; `xsi:nil` / omit → ErrorID `-315` / `-74`). Reactivation of old discharged placements requires **HHA UI** (Patient → Contracts → Edit Discharge Date → clear → Save).

**Discharge pause:** PR #3 **merged** — nightly excludes `discharge_service`. Do not re-enable.

| # | Patient | CaseId | HHA PatientID | Old placement | Old disc | Reactivate (API) | Mistaken NEW (earlier session) | Manual UI needed? |
|---:|---|---|---|---|---|---|---|---|
| 1 | Hooria Arshad | `02891799` | 22854608 | #6812439 | 2026-09-15 | **FAIL** (cannot clear) | #8596053 ACTIVE | **YES** — clear disc on #6812439 |
| 2 | Helena Galeanocarvajal | `04725821` | 23012434 | #6897698 | 2026-09-15 | **FAIL** | #8596089 ACTIVE | **YES** — clear disc on #6897698 |
| 3 | Madison Oliver | `258271503` | 25788276 | #8300861 | 2026-09-15 | **FAIL** | #8596090 ACTIVE | **YES** — clear disc on #8300861 |
| 4 | Edmund Picciuto | `258272446` | 26372249 | #8522217 | 2026-09-15 | **FAIL** | #8596091 ACTIVE | **YES** — clear disc on #8522217 |
| 5 | Roy-Al Porter | `258270052` | 24555059 | #7909108 | 2026-09-15 | **FAIL** | #8596092 ACTIVE | **YES** — clear disc on #7909108 |
| 6 | Caleb Rolon | `P0800016094701` | 24301609 | #7802393 | 2026-09-15 | **FAIL** | #8596093 ACTIVE | **YES** — clear disc on #7802393 |
| 7 | Martin Solomon | `06771684` | 26367422 | #8519959 | *(none — active)* | **OK — already active** | none | no |
| 8 | Michael Asunto | `258270277` | 24617583 | #7935330 | 2026-09-09 | **FAIL** | #8596094 ACTIVE | **YES** — clear disc on #7935330 |
| 9 | Fiona Downs | `258270803` | 24865860 | #8045831 | 2026-09-10 | **FAIL** | #8596095 ACTIVE | **YES** — clear disc on #8045831 |
| 10 | Karlandrew Navelgas | `258267421` | 22680255 | #6711683 | 2026-09-10 | **FAIL** | #8596097 ACTIVE | **YES** — clear disc on #6711683 |

## Summary
- **1/10** old placement already active (Solomon #8519959) — no further action.
- **9/10** old placements still discharged; API clear failed; **manual HHA UI** required to clear Discharge Date on the old placement IDs above.
- **9 kids** also have mistaken **new** active placements from an earlier remediation attempt (IDs in table). Ops may want to discharge those new lines after reactivating the old ones (or leave them — coordinator call). **No additional new contracts were created in this pass.**

## Artifacts
- `infra/revert-discharges-work/reactivate-old-results.json`
- `infra/revert-discharges-work/apply-reactivate-old.mjs`
- Generated: 2026-09-16T20:08:42Z
