# Patient-level reactivate — API blocked; use HHA UI

**Date:** 2026-09-16  
**Scope:** 9 kids fully discharged in HHA (Solomon OK — skip).  
**Do NOT** create new contracts (`AddPatientContract`). Goal = REVERT / reactivate.

## API verdict: NO

| Path | Result |
|------|--------|
| Dedicated `ReactivatePatient` / `Undischarge` / `DischargePatient` | **Not present** in ENT v1.8 surface used by this repo |
| `UpdatePatientContract` clear `DischargeDate` | **FAIL** (empty date → XSD fault; nil/omit → `-315` / `-74`) |
| Patient Status via `UpdatePatientDemographics` → Active | **No proven working path**; discharge in this codebase is placement-only (`UpdatePatientContract`) |
| `SearchPatients` Status filter | Confirms patient-level statuses exist: `All`, `Waiting`, `Active`, `Hospitalized`, `Discharged`, `Hold` |

**Conclusion:** Reactivate entirely discharged patients via **HHA UI only**. Stop further API attempts.

---

## Ops — HHA UI steps (ENT)

Work one child at a time from the list below.

### A. Find the discharged patient

1. Log into **HHAeXchange ENT** (same agency/office as production ops).
2. Go to **Patient → Search** (or **Patients** search).
3. Set **Status** filter to **Discharged** (if missing, use **All**).
4. Search by **Last Name** + **First Name**, or paste **PatientID** if your search supports ID.
5. Open the patient profile. Confirm header/status shows **Discharged**.

> Tip: Default search is often **Active only** — discharged kids will not appear until Status = Discharged or All.

### B. Reactivate patient status (patient-level)

1. On the patient profile, open **Patient Info** / **Demographics** / **Profile** (wording varies by ENT skin).
2. Find **Status** (values include Active / Discharged / Hold / Hospitalized / Waiting).
3. Change **Discharged → Active**.
4. **Save**.
5. Re-search with Status = **Active** and confirm the child appears again.

If Status is read-only or greyed out:
- Some agencies require a **Reactivate** / **Undo Discharge** action under **Actions**, **More**, or a discharge banner — use that, then Save.
- If still blocked, an agency admin role may be required.

### C. Clear Discharge Date on the OLD placement (required for scheduling)

Patient Status = Active is **not enough** if the original placement still has a Discharge Date.

1. Open **Contracts** / **Placements** / **Patient Contracts** on that patient.
2. Find the **OLD** placement (IDs in the table — **not** the #8596xxx lines).
3. **Edit** that placement/contract.
4. Clear **Discharge Date** (empty the field). Clear/adjust discharge reason/to if the UI requires it.
5. **Save**.
6. Confirm the old placement shows **no** discharge date and is usable for visits.

> API cannot do step C. UI can.

### D. Mistaken NEW placements (#8596053+)

Earlier remediation mistakenly added **new active** placements. After A–C:

1. On **Contracts**, find the **NEW** placement ID from the table.
2. Prefer **discharge** that new line (set Discharge Date = today or coordinator-chosen date) so only the **original** placement remains active.
3. Do **not** add yet another contract.
4. If coordinators want to keep the new line and abandon the old one, that is an ops call — default recommendation: **keep old, discharge new**.

Note: A live NEW active placement can make the case look partially “open” in contracts even when the **patient Status** still shows Discharged. Always fix **patient Status** and the **old** placement Discharge Date; then clean up the new line.

### E. Quick verify per child

- [ ] Search Status=**Active** finds the patient  
- [ ] Old placement ID has **no** Discharge Date  
- [ ] Mistaken NEW placement is discharged (or explicitly kept by coordinator)  
- [ ] No extra brand-new contracts created  

---

## Work list (9) — skip Solomon

| # | Patient | HHA PatientID | Old placement (clear disc) | Mistaken NEW (discharge after) |
|---:|---|---|---|---|
| 1 | Hooria Arshad | **22854608** | #6812439 | #8596053 |
| 2 | Helena Galeanocarvajal | **23012434** | #6897698 | #8596089 |
| 3 | Madison Oliver | **25788276** | #8300861 | #8596090 |
| 4 | Edmund Picciuto | **26372249** | #8522217 | #8596091 |
| 5 | Roy-Al Porter | **24555059** | #7909108 | #8596092 |
| 6 | Caleb Rolon | **24301609** | #7802393 | #8596093 |
| 7 | Michael Asunto | **24617583** | #7935330 | #8596094 |
| 8 | Fiona Downs | **24865860** | #8045831 | #8596095 |
| 9 | Karlandrew Navelgas | **22680255** | #6711683 | #8596097 |

**Skip:** Martin Solomon — PatientID **26367422** — already OK.

---

## Related artifacts

- Placement-only API fail: `FINAL-reactivate-report.md`
- Scripts: `reactivate-only.mjs`, `apply-reactivate-old.mjs` (do not re-run for new contracts)
