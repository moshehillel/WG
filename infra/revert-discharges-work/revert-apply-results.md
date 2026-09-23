# Mistaken discharge revert results (APPLY)

HHA UpdatePatientContract cannot clear DischargeDate via API (empty date = XSD fault). Restore = ensure an active placement exists (new AddPatientContract if needed). Original discharged placements remain as history.

| # | Patient | CaseId | HHA PatientID | Original placement | Outcome | Active now | Manual UI? |
|---:|---|---|---|---|---|---|---|
| 1 | Hooria Arshad | `02891799` | 22854608 | #6812439 | **restored_via_new_active_placement** | #8596053 OT SOC/ROC OASIS @ 2026-09-16 | no |
| 2 | Helena Galeanocarvajal | `04725821` | 23012434 | #6897698 | **reopened_via_AddPatientContract** | #8596089 OT SOC/ROC OASIS @ 2026-09-16 | no |
| 3 | Madison Oliver | `258271503` | 25788276 | #8300861 | **reopened_via_AddPatientContract** | #8596090 OT @ 2026-09-16 | no |
| 4 | Edmund Picciuto | `258272446` | 26372249 | #8522217 | **reopened_via_AddPatientContract** | #8596091 PT @ 2026-09-16 | no |
| 5 | Roy-Al Porter | `258270052` | 24555059 | #7909108 | **reopened_via_AddPatientContract** | #8596092 PT @ 2026-09-16 | no |
| 6 | Caleb Rolon | `P0800016094701` | 24301609 | #7802393 | **reopened_via_AddPatientContract** | #8596093 PT @ 2026-09-16 | no |
| 7 | Martin Solomon | `06771684` | 26367422 | #8519959 | **still_discharged_only** | — | YES |
| 8 | Michael Asunto | `258270277` | 24617583 | #7935330 | **reopened_via_AddPatientContract** | #8596094 PT @ 2026-09-16 | no |
| 9 | Fiona Downs | `258270803` | 24865860 | #8045831 | **reopened_via_AddPatientContract** | #8596095 PT @ 2026-09-16 | no |
| 10 | Karlandrew Navelgas | `258267421` | 22680255 | #6711683 | **reopened_via_AddPatientContract** | #8596097 PT @ 2026-09-16 | no |

Generated: 2026-09-16T19:59:19.000Z

## Notes
- Run `886d6a26-a989-a9d4-9e89-74f7a9bfeaef` discharge_service had **7 successes**; plus 3 meeting overlap kids = 10.
- Clearing DischargeDate via SOAP is **not supported** (empty date invalid; nil → -315).
- Discharge pause: PR #3 **merged** — nightly `reportKinds` exclude `discharge_service`.