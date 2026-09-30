# 14. Glossary and FAQ

**What this is for.** This chapter explains the words you meet across the platform — clinic, laboratory, dental, pharmacy, billing and
integrations — and answers questions staff and patients often ask. Each answer describes how the system really behaves today.

**Who uses it.** Everyone: new staff learning the platform, trainers, supervisors, and patients who want to understand a word in MyHealth.

## Glossary

Terms are grouped by area and sorted alphabetically within each group. Words in **bold** inside a definition are defined elsewhere in this glossary.

### Platform and patients

| Term                      | Meaning                                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activation code           | A one-time code (10 letters and numbers, e.g. `ABCDE-23456`) staff give a patient to set up **MyHealth**. Valid 3 days, single use, shown to staff only once.                       |
| Audit trail               | The permanent log of who did what, when, to which patient and record. Entries are never changed or deleted. Sensitive reads (e.g. opening a record) are logged too.                 |
| Consent                   | A patient's recorded decision per consent type (e.g. `portal_access`). The latest decision is the current one; earlier ones stay as history.                                        |
| Communication preferences | A patient's opt-in or opt-out per channel (SMS, email, in-app) and category. Reminders and notices respect them.                                                                    |
| Duplicate review          | When you register a patient, the system shows existing patients who may be the same person so you do not create a second record. There is one record per patient.                   |
| Entered in error          | A way to correct a record that should never have existed (wrong patient, wrong entry). The record is kept, marked and excluded from current care; it is not deleted.                |
| Filed under               | On a surviving record, marks a row that belongs to a record merged into it, e.g. **Filed under P00000123**. The row was not moved.                                                  |
| Facility                  | One branch or site of your **organization** (clinic, laboratory). You choose the facility you are working at; many screens and rules apply per facility.                            |
| Merged record             | A duplicate record retired into the **surviving record** of the same patient. It keeps what was filed under it, is read only and can be unmerged.                                   |
| MFA                       | Multi-factor authentication. Staff, and patients in MyHealth (**Profile → Sign-in security**), may be asked for a 6-digit code from an authenticator app (TOTP) after the password. |
| MyHealth                  | The patient portal: patients see visits, released results, medicines, care plans, bills, messages and (if shared) dental records. See [chapter 12](12-patient-portal.md).           |
| Organization              | Your clinic group as a whole. Settings such as tax profile, dental sharing and reportable conditions are set per organization.                                                      |
| Patient 360               | The clinician's one-screen workspace (`/patients/[id]/360`): alerts, current consultation, problems, medicines, care plans, results and trends, images and history.                 |
| Patient number            | The patient's identifier within your organization (format `P` followed by 8 digits). Printed on cards and receipts; patients use it to set up MyHealth.                             |
| Permission                | A single right such as `encounter.sign`. **Roles** are sets of permissions. A missing button usually means a missing permission.                                                    |
| Placeholder page          | A menu item for a module not built yet. It shows that the module is not available; it holds no data.                                                                                |
| Role                      | A named set of permissions given to a user, e.g. receptionist, nurse, physician, med tech, pathologist, dentist, pharmacist, cashier, records officer, org admin.                   |
| Surviving record          | The record kept when duplicates are merged. Every screen of it also shows the records of each **merged record**, marked **Filed under**.                                            |
| Timeline                  | The patient's record in date order (`/patients/[id]/timeline`): visits, triage, encounters, allergies, specimens, results, prescriptions, dental work, invoices, claims and more.   |

### Clinic, consultations and telemedicine

| Term                        | Meaning                                                                                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Immunization record         | One dose of a vaccine in the patient's history: given here, not given (with the reason), reported (from a vaccination card, possibly only a year or month) or imported. Never edited: corrected by "entered in error". It records what was given, not what is due. |
| Past condition              | An illness diagnosed elsewhere, recorded in the patient's history with its status as reported. Not a diagnosis of this clinic: never on the problem list, billed or reported.                                                                                      |
| Family history state        | Whether the family history was asked: "not recorded — ask the patient", "no known family history" (only after it was recorded), "not known" (adopted, not known, declined) or "recorded".                                                                          |
| Social history version      | One saved snapshot of tobacco, alcohol, work, home, activity, diet (and the private parts); a change is a new version, earlier ones stay listed.                                                                                                                   |
| Vaccine catalogue           | Your organization's own list of vaccines (**Clinic → Vaccines**): names, products, optional codes, route and site options. No national schedule or code set is built in.                                                                                           |
| Allergy review              | A recorded check of the patient's allergies. "No known allergies" appears only after a review; otherwise you see "Allergies not recorded — ask the patient".                                                                                                       |
| Amendment                   | A change to a **signed** encounter note. It needs a reason and the `encounter.amend` permission. The original signed text stays in the revision history.                                                                                                           |
| Appointment                 | A booked time with a practitioner for a **visit type**, at a facility or online. Statuses: booked, confirmed, checked in, completed, cancelled, no-show.                                                                                                           |
| Care plan                   | A plan for a patient's ongoing care: goals, activities (for the patient or the care team, possibly recurring), follow-up bookings and progress notes.                                                                                                              |
| Check-in                    | Marking that the patient has arrived. It puts the patient in the **queue**. A **walk-in** is checked in without an appointment.                                                                                                                                    |
| Decision support            | Warnings the system shows to help you, e.g. a drug–allergy warning when prescribing. It does not decide for you; you may override with a reason, which is audited.                                                                                                 |
| Encounter                   | One consultation of a patient with a practitioner (in person or online): SOAP note, diagnoses, prescriptions, orders. It is signed when finished.                                                                                                                  |
| Escalation (to in-person)   | In an online consultation, the doctor's decision that the patient must be seen in person. The patient sees the recommendation in MyHealth.                                                                                                                         |
| No-show                     | An appointment the patient did not attend. Staff mark it; the patient may get a "we missed you" message.                                                                                                                                                           |
| Queue                       | Today's list of checked-in patients at the facility (`/queue`), who is waiting, called, in triage or with the doctor. It updates live.                                                                                                                             |
| Recall list                 | Patients due for follow-up according to their care plan activities (`/clinic/care-plans`).                                                                                                                                                                         |
| Signing (an encounter)      | Completing the consultation. Only the responsible practitioner can sign. After signing, the note changes only by **amendment**.                                                                                                                                    |
| SOAP                        | Subjective, Objective, Assessment, Plan — the sections of the consultation note.                                                                                                                                                                                   |
| Triage                      | The nurse's first assessment at arrival, with **vital signs** (`/queue/visits/[id]/triage`).                                                                                                                                                                       |
| Visit type                  | The kind of visit (e.g. consultation, follow-up, online consultation) with its duration. Some may be opened for patients to book online.                                                                                                                           |
| Vital signs                 | Measurements such as blood pressure, pulse, temperature, weight. Mistakes are marked **entered in error**, never deleted.                                                                                                                                          |
| Waiting room (telemedicine) | Where an online patient waits after answering the pre-consult questions. It opens 30 minutes before the appointment.                                                                                                                                               |
| Walk-in                     | A patient seen without an appointment, e.g. added to the queue with **Check in (walk-in)** on the patient record.                                                                                                                                                  |

### Laboratory

| Term                      | Meaning                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accession number          | The number given to a specimen when it is collected (facility date `YYMMDD` plus a daily counter). It is printed as a barcode on the tube label and scanned at each step. |
| Approve                   | The second sign-off after **verify**, usually by a pathologist. Depending on facility policy, approval may release the result at once.                                    |
| Correction (of a result)  | A new version of a result. The old version is kept. A released result is never overwritten; correcting it needs `lab.result.amend` and goes through verify/approve again. |
| Critical value            | A result beyond the critical limits of its range. It must be communicated to the care team and acknowledged; patients see it only after acknowledgement.                  |
| Manifest (send-out)       | The dispatch list for specimens sent to a reference laboratory, numbered `SM` plus 8 digits, printable as a PDF.                                                          |
| Panel                     | A named group of tests ordered together; ordering it orders each active test.                                                                                             |
| Patient-releasable        | A test setting: released results of this test may be shown to the patient in MyHealth.                                                                                    |
| Reference range           | The usual range for a test (by sex and age, with critical limits). Ranges are versioned; each result keeps a snapshot of the range used at entry.                         |
| Reference laboratory      | An outside laboratory that performs a **send-out** test. Its accreditation reference is recorded as given, not verified by the system.                                    |
| Rejection (of a specimen) | Refusing a specimen as unsuitable, with a reason. Its unreleased results are cancelled and tests return to collection or are cancelled.                                   |
| Release                   | Making an approved result visible to clinicians (and, if patient-releasable, to the patient). Each release is archived as a report PDF.                                   |
| Send-out                  | A test sent to a **reference laboratory**: dispatched with a manifest, then results entered here attributed to that laboratory ("Performed by").                          |
| Separation of duties      | The person who entered a result may not verify or approve it, unless the facility's laboratory policy allows it (then it is recorded as a self sign-off).                 |
| STAT                      | Urgent priority for an order. STAT work is listed first in worklists.                                                                                                     |
| Turnaround time (TAT)     | Time from collection to release. The dashboard shows overdue items and averages.                                                                                          |
| Verify                    | The first check of an entered result by a second person (technical review) before approval.                                                                               |
| Worklist                  | The list of work at a stage: collect, receive, enter, verify, approve, release (`/laboratory/worklist`).                                                                  |

### Laboratory quality

| Term                  | Meaning                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAPA                  | Corrective and preventive action. Part of a **nonconformance**: what was fixed now and what prevents it happening again, followed by an effectiveness check.                    |
| Competency assessment | A recorded assessment of a staff member for a test or section. A facility may require a current "competent" state before a person can enter results.                            |
| Control (QC) material | A sample with known expected values, run like a patient sample to check the instrument. Each lot has a target mean and SD per test and instrument.                              |
| EQA                   | External quality assessment (proficiency testing): an outside provider sends samples; you report results and record the provider's evaluation. Unacceptable opens an NC.        |
| Levey-Jennings chart  | A chart of control values over time against the target mean and ±1, 2, 3 SD lines (`/laboratory/qc`).                                                                           |
| Nonconformance (NC)   | A recorded quality incident (numbered `NC` plus 8 digits), with investigation, root cause, CAPA and effectiveness check before closing.                                         |
| QC run                | One recorded control result, evaluated by the facility's **Westgard rules** as accepted, warning or rejected.                                                                   |
| Cost per patient run  | A loaded reagent lot's stock cost divided by its patient runs, shown once the lot is unloaded (QC, repeats, waste and unused tests are included in the cost). Operational only. |
| Patient run           | One order measured on an instrument: the tests of one order entered together count once against the reagent lot; a correction entered on the instrument is a re-run.            |
| Reagent lot           | An inventory lot of a reagent loaded on an instrument. Results record which lots were in use. An expired lot in use blocks QC and results for its tests.                        |
| Running low (reagent) | A loaded reagent lot with a tenth or less of its tests left. Shown on the lot and the dashboard; quality managers get one in-app notice per lot.                                |
| Tests per unit        | How many tests one stock unit of a reagent performs (its yield). Used to work out what a lot taken from stock holds when **Tests it holds** is not given.                       |
| SD                    | Standard deviation: how far control values usually spread around the target mean.                                                                                               |
| Temperature excursion | A storage-unit reading outside its allowed range. It needs a note and opens a nonconformance.                                                                                   |
| Westgard rules        | Standard rules for judging QC runs. Available: 1-2s (always only a warning), 1-3s, 2-2s, R-4s, 4-1s, 10-x. The facility chooses which rules reject (default 1-3s, 2-2s, R-4s).  |

### Dental

| Term                   | Meaning                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FDI notation           | The two-digit tooth numbering (ISO 3950): first digit = quadrant, second = tooth (e.g. 16 = upper right first molar). The system stores teeth in FDI.     |
| Odontogram (chart)     | The tooth chart. It is built from examinations and procedures over time; the current chart is derived from that history, never edited directly.           |
| Palmer / Universal     | Other tooth notations. The organization chooses which one staff and patients see (`/dental/settings`); storage stays FDI.                                 |
| Periodontal chart      | Gum measurements per tooth site (e.g. pocket depths), recorded by a dentist during a visit.                                                               |
| Surfaces (M D O/I B L) | Tooth surfaces: mesial, distal, occlusal (back teeth) or incisal (front teeth), buccal, lingual. The system checks that a surface is valid for the tooth. |
| Treatment plan         | Proposed dental treatments, item by item. The patient accepts or declines each item; procedures complete accepted items.                                  |

### Pharmacy and inventory

| Term                | Meaning                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Controlled item     | An inventory item flagged as controlled. Every movement needs a reason and a reference. (Regulatory dangerous-drug registers are not built in.)                |
| Dispense            | Giving out items of an active prescription from a location's stock. Stock leaves inventory at the same moment.                                                 |
| FEFO                | First-expiry-first-out: when stock is issued, the lot that expires soonest is used first. Expired lots are never issued.                                       |
| Location            | A place that holds stock at a facility (e.g. pharmacy, laboratory store).                                                                                      |
| Lot                 | A batch of an item with its own lot number and expiry date.                                                                                                    |
| Purchase order (PO) | An order to a supplier (`PO-YYYY-NNNNNN`): draft → submitted → approved (never by the submitter) → partially received → received, or cancelled / closed short. |
| Reorder level       | The stock level at or below which an item is suggested for reordering. Suggestions count stock already on open orders.                                         |
| Reversal (dispense) | Undoing a mistaken dispense, once, with a reason. The same lots go back to stock.                                                                              |
| Stock count         | A physical count of a lot; the difference is posted as an adjustment with a reason.                                                                            |
| Stock ledger        | The permanent list of every stock movement (receive, issue, transfer, count, write-off, return). Balances come from it and never go below zero.                |
| Write-off           | Removing expired, damaged or lost stock, with a reason. Expired lots can only leave stock this way.                                                            |

### Billing

| Term           | Meaning                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Charge         | One billable item for a patient. Many are captured automatically from clinical work (signed encounter, lab test ordered, dental procedure); others are added manually. |
| Credit note    | A document that reduces an issued invoice (or its debit note) without voiding it, with a reason. It may reduce the patient's share or a payer's pending coverage.      |
| Debit note     | A document that adds services or an adjustment to an issued invoice, with a reason. It has its own number.                                                             |
| Deposit        | Money a patient pays in advance, kept on their account at a facility with a receipt. The cashier applies it to invoices or refunds it.                                 |
| Discount rule  | A configured discount (e.g. Senior Citizen or PWD) applied to certain service categories. Some require evidence such as an ID number, stored masked.                   |
| Invoice        | The bill: draft → issued (numbered, e.g. `INV-2026-000001`, then unchangeable) → void. An issued invoice is corrected by credit/debit note or by void and reissue.     |
| Package        | A priced service with fixed contents. While active, included services are charged at ₱0 until used up.                                                                 |
| Payer coverage | The part an HMO (with its LOA reference), PhilHealth or insurer covers. It is followed up after issue: submitted, settled or denied.                                   |
| Receipt number | The number on payments and deposits (e.g. `AR-2026-000001`).                                                                                                           |
| VAT class      | Each service's VAT treatment (vatable, VAT-exempt, zero-rated). Needed on issue when the organization is VAT-registered; the invoice keeps a VAT breakdown.            |
| Void           | Cancelling an issued invoice with a reason, usually replaced by a new draft (reissue). Payments must be refunded first; applied deposits return to the account.        |

### PhilHealth, DOH and interoperability

| Term                             | Meaning                                                                                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter / integration dependency | The connector to an outside system. Where no official specification is on record, no adapter exists: nothing is transmitted, and you record things manually.                                          |
| Case report (DOH)                | Opened for review when a recorded diagnosis matches one of the organization's reportable conditions (`/reporting`). You record it as reported through DOH's own channel, or dismiss it with a reason. |
| eClaims                          | PhilHealth's electronic claims. The platform prepares a claim package from the invoice and checks readiness, but **does not transmit** until an adapter is configured.                                |
| Eligibility (PhilHealth)         | PhilHealth's answer about a member's eligibility, recorded by staff with its reference from PhilHealth's own channel. The platform never decides eligibility.                                         |
| External history                 | Conditions, observations, medicines or documents accepted from an imported record. Labelled as external; never turned into diagnoses, results or prescriptions.                                       |
| FHIR                             | Fast Healthcare Interoperability Resources (R4): the standard format for exchanging health records. The platform offers read access for authorized systems and an import review queue.                |
| Import review queue              | Records received in FHIR format wait at `/records/imports` until a reviewer matches the patient and accepts or rejects each entry.                                                                    |
| Integration exchange             | A logged attempt to send something to an outside system. Administrators review failed or stalled ones at `/admin/integrations`.                                                                       |
| Reportable condition             | An organization-defined rule (ICD-10 code prefixes → its own category) that opens DOH case reports. No national list is built in.                                                                     |
| YAKAP                            | PhilHealth's primary care program. Staff record the facility's participation reference and PhilHealth's answer on a patient's registration; consultation packages are prepared, **not transmitted**.  |

## FAQ

### For staff

**1. A button I need is missing. Why?**
Buttons appear only for users whose role has the permission. For example, **Invite to portal** needs `patient.portal.manage`, amending a signed note
needs `encounter.amend`, and issuing a refund needs `billing.refund.issue`. Ask your administrator. The server checks permissions again on every
action, so a hidden button is not a bug. See [Administration](13-administration.md).

**2. How do I fix a mistake in a signed consultation note?**
Use **Amend note** in the encounter workspace and give a reason (you need `encounter.amend`). The signed text stays in the revision history. You cannot
mark a signed encounter entered in error — "Signed encounters are corrected by amendment". An unsigned encounter started for the wrong patient can be
marked entered in error with a reason. See [Consultations](04-consultations-and-care-plans.md).

**3. Can I delete a record entered by mistake?**
No. Clinical records are never deleted. Mark them **entered in error** with a reason (vital signs, diagnoses, dental examinations and procedures,
imported history). They stay visible as history, marked, and are excluded from current care.

**4. I registered the same patient twice. Can I merge the records?**
Yes — a records officer merges them from the patient record (**Merge duplicate…**): nothing is moved, the retired record becomes read only and the
surviving record shows both histories. A merge can be undone. See [Records, reporting and integrations](11-records-reporting-and-integrations.md#how-to-merge-duplicate-patient-records).
Always use the duplicate review when registering, so duplicates are rare.

**5. Why does the patient header say "Allergies not recorded — ask the patient"?**
No allergy review has been recorded, or the allergy list changed after the last review. Ask the patient and record their allergies, or confirm no known
allergies. Users without clinical access see "Allergies: no access" instead.

**6. Why can't I verify or approve a result I entered myself?**
Separation of duties: "The person who entered a result cannot also verify it at this facility (separation of duties). Ask a colleague, or change the
facility laboratory policy." Only the facility's laboratory policy can allow self sign-offs, and they are recorded as such.

**7. The patient says their result is not in MyHealth. Why?**
A result is shown to the patient only if it is released, the test is set as patient-releasable in the catalog, and — if critical — the care team has
acknowledged it. While a released result is being corrected, it is hidden until the new version is released.

**8. Why was result entry refused for a test?**
Common reasons: the specimen has not been received; the test was sent out ("record that its results came back before entering them"); QC is required
and not accepted ("Run QC before entering patient results"); an expired reagent lot is in use; or competency is required and yours is not current. See
[Laboratory](06-laboratory.md) and [Laboratory quality](07-laboratory-quality.md).

**9. How do I correct an issued invoice?**
Issued invoices cannot be edited. Use **Issue credit note…** to reduce it, **Issue debit note…** to add to it, or **Void…** and reissue a corrected
invoice (refund payments first). See [Billing](10-billing.md).

**10. Can we submit PhilHealth claims, eligibility checks, YAKAP or DOH reports electronically?**
Not yet. No official specification is on record, so nothing is transmitted and submission is refused ("integration_not_configured"). Submit through the
agency's own channel and record the reference in the platform. The same applies to online patient payments (no payment provider configured by
default) and electronic exchange with reference laboratories. See [Records, reporting and integrations](11-records-reporting-and-integrations.md).

**11. Why won't the system let me issue stock from a lot?**
Expired lots are never issued — "…expired on …; write it off instead". Stock cannot go below zero ("Not enough stock in this lot"). Issues use the lot
that expires first unless you name one. See [Pharmacy and inventory](09-pharmacy-and-inventory.md).

**11a. How do I see how much of a reagent lot is left, or what it costs per test?**
Open **Laboratory → Instruments**: each loaded lot shows the tests used and left ("42 of 100 tests used · 58 left"). Record repeats, calibration,
priming or waste with **Record use…**. **Laboratory → Reagent use** shows use over a period, lots running low, and the cost per patient run of lots
already unloaded. See [Laboratory quality](07-laboratory-quality.md#how-to-follow-reagent-use-per-test-run).

**12. A patient forgot their MyHealth password. What do I do?**
The patient can use **Forgot your password?** on the MyHealth sign-in page: a link goes to the account's email and, with their date of birth, lets
them choose a new password (see [MyHealth](12-patient-portal.md#how-to-reset-your-password)). If they cannot reach that email, on the patient
record's portal access panel choose **Disable access** (reason, e.g. "Patient request"), then **Issue new code** and give the code to the patient in
person after checking their identity. The patient sets up the account again.

**13. Why are times shown as they are?**
Clinical times are shown in the facility's time zone (Asia/Manila by default), whatever the time zone of your computer.

### For patients

**14. I did not receive my activation code, or it expired.**
Ask the clinic's front desk. Codes are only given in person after checking your identity, and they expire after 3 days. A new code replaces the old one.

**15. Why can't I book or change a visit online?**
Your clinic may not have opened that kind of visit for online booking. Each clinic sets its own rules; unless it has, you must book at least 2 hours ahead and at most 60 days ahead, you can have up to
3 open online bookings, and changes close 2 hours before the visit. If the day you want is full, some clinics let you ask to be told when a time opens
(**Tell me if a time opens**). Call the clinic for anything else.

**16. I got a text that my results are ready, but it does not say what they are.**
That is on purpose, for your privacy. Sign in to MyHealth and open **Results**. Talk to your doctor about what they mean.

**17. Can I reply to a message in MyHealth?**
Yes. Open the conversation under **Messages** and write in it, or start a new one with **New message**. Messages are read during clinic hours, not all
day, and are not for urgent problems: call the clinic, and 911 in an emergency. See [MyHealth](12-patient-portal.md#how-to-write-to-the-clinic).

**18. Why don't I see Dental in MyHealth?**
Your clinic has not turned on sharing of dental records, or there is nothing to show yet. Ask the clinic if you need a copy of your dental record.

## Related chapters

- [Getting started](01-getting-started.md)
- [Patients](02-patients.md)
- [Appointments and queue](03-appointments-and-queue.md)
- [Consultations and care plans](04-consultations-and-care-plans.md)
- [Telemedicine](05-telemedicine.md)
- [Laboratory](06-laboratory.md)
- [Laboratory quality](07-laboratory-quality.md)
- [Dental](08-dental.md)
- [Pharmacy and inventory](09-pharmacy-and-inventory.md)
- [Billing](10-billing.md)
- [Records, reporting and integrations](11-records-reporting-and-integrations.md)
- [MyHealth — your patient portal](12-patient-portal.md)
- [Administration](13-administration.md)
