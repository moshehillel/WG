# Mistaken discharge remediation — REACTIVATE OLD ONLY

REVERT only: UpdatePatientContract to clear DischargeDate on ORIGINAL placements. No AddPatientContract. Mistaken new placements from earlier session are documented, not created again.

| # | Patient | CaseId | HHA PatientID | Old placement | Old disc date | Reactivate outcome | Mistaken NEW placement (earlier) | Manual UI? |
|---:|---|---|---|---|---|---|---|---|
| 1 | Hooria Arshad | `02891799` | 22854608 | #6812439 | 2026-09-15 | **reactivate_failed_api_cannot_clear_discharge** | #8596053 ACTIVE | YES |
| 2 | Helena Galeanocarvajal | `04725821` | 23012434 | #6897698 | 2026-09-15 | **reactivate_failed_api_cannot_clear_discharge** | #8596089 ACTIVE | YES |
| 3 | Madison Oliver | `258271503` | 25788276 | #8300861 | 2026-09-15 | **reactivate_failed_api_cannot_clear_discharge** | #8596090 ACTIVE | YES |
| 4 | Edmund Picciuto | `258272446` | 26372249 | #8522217 | 2026-09-15 | **reactivate_failed_api_cannot_clear_discharge** | #8596091 ACTIVE | YES |
| 5 | Roy-Al Porter | `258270052` | 24555059 | #7909108 | 2026-09-15 | **reactivate_failed_api_cannot_clear_discharge** | #8596092 ACTIVE | YES |
| 6 | Caleb Rolon | `P0800016094701` | 24301609 | #7802393 | 2026-09-15 | **reactivate_failed_api_cannot_clear_discharge** | #8596093 ACTIVE | YES |
| 7 | Martin Solomon | `06771684` | 26367422 | #8519959 | (active/missing) | **old_already_active** | none | no |
| 8 | Michael Asunto | `258270277` | 24617583 | #7935330 | 2026-09-09 | **reactivate_failed_api_cannot_clear_discharge** | #8596094 ACTIVE | YES |
| 9 | Fiona Downs | `258270803` | 24865860 | #8045831 | 2026-09-10 | **reactivate_failed_api_cannot_clear_discharge** | #8596095 ACTIVE | YES |
| 10 | Karlandrew Navelgas | `258267421` | 22680255 | #6711683 | 2026-09-10 | **reactivate_failed_api_cannot_clear_discharge** | #8596097 ACTIVE | YES |

## API note
- HHA SOAP `UpdatePatientContract` accepts setting a discharge date, but **clearing** DischargeDate (empty / xsi:nil / omit) consistently fails (XSD fault or ErrorID -315).
- Per HHA docs, DischargeToID/ReasonID are required only when DischargeDate is **not** blank — implying blank should clear, but the ASMX schema rejects empty dateTime.
- **Manual HHA UI** (Patient → Contracts → Edit Discharge Date → clear/save) is the supported path when API clear fails.

## Discharge pause
- PR #3 merged: nightly `reportKinds` exclude `discharge_service` (do not re-enable).

Generated: 2026-09-16T20:08:42.555Z