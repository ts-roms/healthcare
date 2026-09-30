# 2. Patients

**What this is for.** Every patient has exactly one record in your organization, shared by the clinic, laboratory, dental, telemedicine, pharmacy and billing.
This chapter shows how to find a patient, register a new one without creating a duplicate, read the patient record, record allergies and consent, give the
patient access to MyHealth (the patient portal), send them a MyHealth message, use the Patient 360 workspace and the timeline. It also covers the PhilHealth
eligibility and YAKAP answers kept on the record, and the laboratory reports archived there.

**Who uses it.** Receptionists and records officers (search, registration, consent, MyHealth access), nurses and physicians (allergies, clinical summary,
timeline, Patient 360), cashiers and receptionists (PhilHealth answers), and anyone who needs to look up a patient.

## How to find a patient

1. Select **Patients** in the sidebar, or type in the top-bar search box and press Enter (press `/` to jump there).
2. In **Name, patient no. or mobile**, type at least 2 characters. Examples: `dela cruz juan`, a patient number such as `P00001234`, or a mobile number in any
   Philippine format. Accents don't matter: "pena" finds "Peña".
3. Optionally add the **Birth date** to narrow the list. You can also search by birth date alone.
4. Select **Search**.
5. Select the patient's name to open their record, or **360** next to it to open the Patient 360 workspace. Use **Previous** and **Next** when there is more
   than one page (25 per page).

The results show only what you need to pick the right person: name, **Patient no.**, **Birth date**, **Age / Sex**, a masked **Mobile** number and
**Status**. Inactive and merged records are not listed. If you search for the patient number, mobile number or an identifier of a record that was merged
into another, the surviving record is listed with the note "Found through P… , merged into this record".

If nothing matches, the page says "No patients match. Check the spelling, or try the birth date or mobile number." If you may register patients, a **Register
a new patient** button appears.

If you don't see **Patients** in the sidebar, you need the `patient.search` permission.

## How to register a new patient

Always search first. Registration also checks for existing records, but searching saves time.

1. Select your facility in the top bar. Patients are registered at a facility.
2. Select **Register patient** (on the **Patients** page or the dashboard).
3. Fill in **Identity**: **Family name \***, **Given name \***, **Middle name**, **Suffix** (e.g. "Jr., III"), **Sex \*** (Female, Male, Intersex, Unknown)
   and **Birth date \***. If the exact date is unknown, tick **Estimated (exact date unknown)**.
4. Fill in **Contact & identifiers** if you have them: **Mobile** (e.g. `0917 123 4567`), **Email**, **PhilHealth PIN** (12 digits, e.g. `12-345678901-2`),
   **City / municipality**, **Barangay** and **Province**.
5. Select **Register patient**.
6. If no possible duplicate is found, the patient is registered. A message shows the new patient number and the record opens.

If you don't see **Register patient**, you need the `patient.register` permission (receptionists, nurses, physicians, dentists and dental assistants have it by
default).

> An address needs its **City / municipality**. If you enter a barangay or province without one, the form asks for it ("Enter the city or
> municipality to save the address") instead of registering the patient without the address.

## How to review possible duplicates

If the system finds records that may be the same person, the form locks and a **Possible existing records** panel opens. Each candidate shows the name,
patient number, a match level (**Certain match**, **High match** or **Possible match**) and why it matched, for example "Same name and birth date", "Same
mobile/email and birth date" or "Similar name, day/month swapped".

1. Select **Open record** on each candidate. It opens in a new tab. Compare the details with the patient in front of you.
2. If one of them is the patient, stop. Close the form (**Edit details**, then **Cancel**) and use the existing record.
3. If you are sure none of them is the patient:
   1. Tick **I checked this record and it is a different person** for every candidate.
   2. In **Why is this a different person? \***, write the reason (at least 5 characters), for example "Twins; confirmed different mother's name".
   3. Select **Register as a new patient**.
4. To correct what you typed instead, select **Edit details**.

A **Certain match** means the same identifier (for example the same PhilHealth PIN) is already on another record. You cannot register over it: "A record with
the same identifier exists. Use that record instead of registering a new one."

Your reason and the records you reviewed are kept in the audit trail. A duplicate record splits the patient's history, so take care here.

If you find that the same person is **already** registered twice, don't register a third record: use one of the existing records and tell a records
officer, who can merge the two (see [Records, reporting and integrations](11-records-reporting-and-integrations.md#how-to-merge-duplicate-patient-records)).
Registration never merges records by itself.

## How to read the patient record

Open a patient from the search results. The record (`/patients/[id]`) shows:

- **Patient banner** at the top: name, patient number, age, sex and the allergy statement.
- A yellow **Record status** line if the patient is not active (for example deceased, with the date). A merged (retired) record instead says **Merged into
  P… on … by …** with a link to the surviving record; it is read only.
- **Merged records** (on a surviving record): the patient numbers merged into this record, when, and the merge history. Everything filed under those
  numbers — allergies, problems, prescriptions, consultations, results, dental work, bills — is shown on this record, each row marked **Filed under P…**.
- **Action buttons** (each only if you have the permission):
  - **Patient 360** — the doctor's one-screen workspace (see below).
  - **Timeline** — the whole record in date order (see below).
  - **Check in (walk-in)** — put the patient in today's queue (`clinic.queue.manage`). See [Appointments and queue](03-appointments-and-queue.md).
  - **Book appointment** (`appointment.manage`).
  - **Billing** — the patient's charges and invoices (`billing.charge.read`). See [Billing](10-billing.md).
  - **Dental record** (`dental.record.read`). See [Dental](08-dental.md).
  - **Merge duplicate…** (`patient.merge`, records officers and organization administrators). See
    [Records, reporting and integrations](11-records-reporting-and-integrations.md#how-to-merge-duplicate-patient-records).
- **Demographics**, **Contact & address**, **Identifiers** (PhilHealth PIN, PhilSys, SC/PWD ID, HMO) and **Emergency contacts & guardians**.
- **Clinical summary** (clinical staff only): **Allergies**, **Problems**, **Active prescriptions**, **Latest vitals**, **Recent encounters**, **Upcoming
  visits** and **Care plans**. Without clinical access you see "No access to clinical information" instead. Ask a nurse or physician before any clinical
  decision.
- **PhilHealth eligibility** and **PhilHealth YAKAP** (if you have the PhilHealth permissions).
- **Consent & communication**, **Recent activity**, **Referrals** (the patient's referrals with their status and **Overdue** when your organization flags
  them; select one to open it), **Laboratory results**, **Archived laboratory reports**, **External history (imported)** and **Patient portal
  (MyHealth)**.

The footer shows when the record was registered and last updated. Opening a record is recorded in the audit trail.

> There is no screen yet to edit demographics, contacts, addresses or identifiers after registration, to add emergency contacts or relationships, to change a
> patient's status (inactive, deceased) or to set communication preferences. Ask your administrator how your organization handles these requests. Duplicate
> records are merged by records officers (**Merge duplicate…**).

## How to record allergies

Allergies can be recorded on the patient record, at triage and in the encounter workspace. The panel is the same everywhere.

**To record an allergy:**

1. In **Clinical summary → Allergies**, select **Record allergy**.
2. Enter the **Substance \*** (e.g. "Penicillin, shrimp, latex") and choose the **Category** (Medication, Food, Environment, Biologic / vaccine, Other).
3. Optionally describe the **Reaction** (e.g. "Hives, throat swelling").
4. Choose **Severity** (Not known, Mild, Moderate, Severe), **Criticality** (Unable to assess, Low, High (risk of a life-threatening reaction)) and
   **Verification** (Reported, unconfirmed, or Confirmed).
5. Select **Record allergy**.

**To record that the patient has no known allergies:** when nothing is recorded, select **Patient reports no known allergies**. The banner then says "No known
allergies (reviewed)".

**To record a review** when allergies are already listed: after going through them with the patient, select **Reviewed with patient**. "Last reviewed" shows
the date.

**To take an allergy off the active list:** select **Resolved…**, **No longer relevant…** or **Entered in error…** next to it, write the reason (at least 3
characters) and select **Confirm**. Select **Keep** to cancel. Allergies are never edited in place: if one was recorded wrongly, mark it **Entered in error**
and record it again.

Allergies from another provider's records (imported) show **External record**, and are **Unconfirmed** until a clinician confirms them.

If you don't see **Record allergy**, you need the `allergy.manage` permission (nurses, physicians, dentists and dental assistants by default).

## Consents the patient withdrew in MyHealth

A patient may withdraw some consents in MyHealth (online consultations, sharing with their HMO or PhilHealth, research, MyHealth itself). The
decision appears in **Consent & communication** and in the history marked **by the patient in MyHealth**. Withdrawing MyHealth signs the patient
out; to restore access, record a new grant and, if needed, issue a new code.

## How to record consent

Consent decisions are kept per type. A new decision replaces the current one for that type, and the earlier ones stay in the history.

1. In **Consent & communication**, select **Record consent**.
2. Choose the **Consent**:
   - Processing of personal data
   - General consent to treatment
   - Telemedicine consultations
   - Sharing data with HMO
   - Sharing data with PhilHealth
   - Patient portal access (MyHealth) — needed before a MyHealth invitation
   - Use of data for research
3. Choose the **Patient's decision**: **Granted**, **Refused** or **Withdrawn**.
4. Choose **How it was given**: **Signed paper form**, **Electronic signature** or **Verbal (witnessed by staff)**.
5. Optionally set **Ends on (optional)** — only for granted consent, and after today.
6. Optionally attach the **Signed form (optional)**: a PDF, JPEG, PNG or HEIC file of up to 10 MB. You need `document.upload` to see this field.
7. Optionally add **Notes (optional)**, for example who signed for the patient.
8. Select **Save consent**.

Record only what the patient, or their authorized representative, decided. The decision takes effect immediately.

- The list shows the current decision per type with a badge: **Granted**, **Expired**, **Not yet in effect**, **Refused** or **Withdrawn**.
- Select **Show consent history** to see every decision ever recorded. Select **Hide** to close it.
- Select **Signed form** to open an attached form in a new tab (needs `document.read`; allow pop-ups). The link is short-lived and each opening is audited.
- Communication preferences (for example SMS reminders opted in or out) are listed next to consent. They cannot be changed from this screen yet. The patient can change their own text message and email choices in MyHealth (**Profile → Notification settings**); the latest choice, from either side, applies.

If you don't see **Record consent**, you need the `patient.consent.manage` permission. Consent cannot be recorded on a merged record.

## How to give a patient access to MyHealth

MyHealth is the patient portal. The patient activates their account with a one-time code you give them.

1. Record the **Patient portal access (MyHealth)** consent as **Granted** (see above). Without it, the MyHealth card says "Record the patient's portal access
   consent (under Consent & communication) before inviting them."
2. In **Patient portal (MyHealth)**, select **Invite to portal**.
3. The **Activation code — shown only once** appears. Give it to the patient in person after checking their identity.
4. Tell the patient to set up their account in MyHealth with their patient number, their date of birth and this code. The code expires after 72 hours.
5. Select **Done — hide code**.

The card shows the account's status:

| Status                 | Meaning                                                        |
| ---------------------- | -------------------------------------------------------------- |
| No portal account.     | The patient was never invited.                                 |
| **Invited**            | A code was issued and is still valid ("Code expires …").       |
| **Invitation expired** | The code can no longer be used. Select **Issue new code**.     |
| **Active**             | The patient has signed up. Shows their email and last sign-in. |
| **Disabled**           | Access was disabled. Shows when and why.                       |

If the patient's last sign-up attempt failed, the card tells you why, for example "the date of birth did not match the patient record" or "the activation code
was wrong (only the latest code issued works)", with the number of wrong attempts (up to 5). The patient only sees a general message, so help them from here.
Issuing a new code replaces any earlier unused code.

**To disable access:** select **Disable access**, write the **Reason for disabling** (at least 5 characters, e.g. "Patient request; lost phone") and select
**Disable portal access**. The patient is signed out everywhere.

Recording the portal consent as **Refused** or **Withdrawn** also ends access: the patient is signed out at their next action and cannot be invited again until
they grant consent.

The card also shows **Email verified** or **Email not verified** (the patient confirms their email in MyHealth), and **Two-step verification on** when the
patient uses an authenticator app. If a patient lost their phone and their recovery codes, check their identity in person, select **Turn off two-step
verification**, write the reason (at least 5 characters) and confirm: the patient is signed out everywhere, told by email, and can set it up again.

If you don't see **Invite to portal** or **Disable access**, you need the `patient.portal.manage` permission (receptionists and records officers by default).
Invitations are only possible for active patients.

## How to give a guardian or caregiver access to a patient's MyHealth

Use this for a parent of a child, or an adult who helps an older patient. Check the person's identity and their right to act by the clinic's own procedure
first; the system records what you checked and decides nothing about who may act.

1. The guardian needs their own **active MyHealth account**, and the patient's **Patient portal access (MyHealth)** consent must be **Granted** (given by the
   guardian for a child).
2. On the patient's record, in **Patient portal (MyHealth)**, under **Guardians and caregivers**, select **Add a guardian or caregiver…**.
3. Enter the guardian's **patient number**, the **Relationship**, the **Right to act**, and **What was checked** (documents seen, who verified; no clinical
   detail). Tick **May also make changes** if they may book, message and request records; leave it off for view-only access. Add **Ends on** if access
   should stop on a date.
4. Select **Give access**. The patient (if they have an account) is emailed.

The list shows each person with their status and what was checked. To stop access, select **End access** and give the reason. Access also ends if the
patient (an adult) or the guardian ends it in MyHealth, and stops when the patient's portal consent is withdrawn. Each action the guardian takes is audited
with the guardian as the actor. In **Messages**, what a guardian wrote is labelled "written by a parent or guardian".

If you don't see **Add a guardian or caregiver…**, you need the `patient.portal.proxy.manage` permission (org admins, receptionists and records officers).
A guardian may act for at most 10 people.

## How to start a conversation with a patient in MyHealth

For a patient with an **Active** MyHealth account:

1. In **Patient portal (MyHealth)**, select **Message in MyHealth**.
2. Choose what it is **About**, enter a **Subject** (up to 100 characters) and the **Message** (up to 2,000 characters), e.g. "Please bring your previous
   results."
3. Select **Send**, then **Open the conversation** if you want to follow it.

The patient reads it after signing in to MyHealth and can answer there. They get a text or email saying a message is waiting, never what it says. Do not use
it for urgent or sensitive results — call the patient. To see everything written to and by this patient, select **Conversations with this patient in MyHealth**.

If you don't see **Message in MyHealth**, you need the `patient.message.manage` permission (org admins, receptionists, nurses, physicians, dentists and records
officers by default), and the patient needs an active account. See also [Patient messages](11-records-reporting-and-integrations.md#how-to-answer-patient-messages).

## How to see what was sent to a patient

In **Consent & communication** on the patient record, select **Messages sent to this patient** (you need `notification.read`: organization
administrators, physicians, dentists, receptionists and records officers by default). The page lists every reminder, notice and MyHealth alert the
clinic sent — or held back — newest first:

- **Message** says what it was about (for example "Appointment reminder", "Results ready in MyHealth") and whether a staff member asked for it or
  the platform sent it on its own. The content itself is never shown: messages outside MyHealth never carry clinical detail anyway.
- **Channel** is text message, email, push or the MyHealth inbox, with the number or address partly hidden.
- **Status** is shown with colour, icon and words: **Delivered**, **Sent**, **Waiting to send**, **Failed** (with the number of attempts),
  **Cancelled** or **Not sent** with the reason — for example "No mobile number on record", "The patient turned this off" or "The patient has
  not agreed to reminders and outreach".
- The patient's **Communication preferences** are shown above the list.

When a patient says they got nothing, look for **Not sent** and its reason: update the mobile number or email on the record, or record the
patient's preferences in **Consent & communication**. **In the communication log** opens the same patient in the organization's log.

## How to use the Patient 360 workspace

Patient 360 (`/patients/[id]/360`) puts what a clinician needs before and during a consultation on one screen. Open it with **Patient 360** on the patient
record, **360** in the search results, **Patient 360** on a queue ticket, or **Patient 360** in the encounter workspace's banner.

- **Banner** — name, patient number, age, sex, the allergy statement and the PhilHealth PIN masked to its last four digits. **Open consultation** appears when a
  consultation is in progress; **Patient record** and **Timeline** go to those screens.
- **Alerts** under the banner, each with an icon and words (never colour alone): critical results not yet acknowledged by the care team (select one to open
  **Critical results**), chronic problems, a refused or withdrawn treatment, data-processing or telemedicine consent, no MyHealth consent, and the record's
  status when it is not active.
- **Current consultation** — the consultation in progress (yours at your facility first), with its note state (draft saved or not started), diagnoses, open
  laboratory orders and active prescriptions. Select **Open in the encounter workspace** to write the note, add diagnoses, order tests or prescribe. When none
  is in progress and the patient is in today's queue at your facility, you can **Start consultation** (or open Telemedicine for an online visit); otherwise it
  says "No consultation in progress."
- **Recent consultations** — the last five, with their diagnoses. Select one to open it.
- **Recent activity** — the latest timeline entries; **Full timeline** opens the timeline.
- **Laboratory results** — the latest released value of the patient's most relevant tests (critical and abnormal first, then tests with earlier results), with
  **Trend** for each and a small chart for up to two tests. **All results** goes to the record's laboratory section.
- **Open laboratory orders** — each order's priority, when it was ordered and each test's stage (for example "To collect").
- **Referrals** — open referrals first, then the latest finished ones: number, to whom, urgency, status and **Overdue** when your organization flags
  them. Select one to open it (the reason is read there).
- **Images and documents** — dental radiographs and photos and the documents uploaded for the patient. Select one to open it (a link valid for a few minutes;
  each opening is recorded).
- **Problem list**, **Active medications** (with prescriber, prescription number and date), **Care plans** (with the next due activity and **Overdue** when it
  is past) and **Latest vitals**.

Every panel shows only what your role may read. A panel you may not see says "Not available to you." — it never means "none". Nothing is edited here: each
panel links to the screen where the work is done. Opening Patient 360 is recorded in the audit trail.

When other records were merged into this patient, a line under the alerts says "Includes the records of P…", and every row filed under one of those numbers
says **Filed under P…** (consultations, orders, results, problems, medicines, referrals, images and documents). Opening Patient 360 of a merged (retired) record opens
the surviving record's workspace.

## How to use the timeline

The timeline puts the patient's whole record in one list, newest first, grouped by day.

1. On the patient record, select **Timeline** (or **Open timeline** in **Recent activity**).
2. Use the chips to show only some kinds: **Visits** (appointments, check-ins, triage, consultations, vital signs, referrals and medical certificates),
   **Allergies and consents**, **Prescriptions** (with what was dispensed), **Laboratory** (orders, specimens collected, received or rejected, results
   released and critical results communicated and acknowledged), **Dental** (with images and periodontal charts), **Care plans**, **Billing** (invoices,
   payments, credit and debit notes, deposits), **PhilHealth and DOH** (claims, eligibility and YAKAP answers, case reports), **Messages**, **Imported
   history**, **Documents and requests** (uploaded documents and records requests) and **Immunizations**. Select a chip again to turn it off.
3. To limit the dates, fill in **From** and **To** and select **Apply dates**.
4. Select **Clear filters** to see everything again.
5. Select **Load more** at the bottom for older entries.
6. Select an entry to open the full record it summarizes (for example the encounter or the laboratory results).

Each entry is a short summary: codes, names, numbers and statuses, never notes, reasons, result values, vital values, reactions or message text. Records
entered in error, cancelled or voided stay listed and are marked. Times are in the facility's time zone. Allergies, consents, records requests and PhilHealth
claims belong to the whole record, not a facility. The patient's past history (surgeries, family and social history) is not on the timeline: open
**Medical, family and social history** instead.

You see only the kinds your role allows. For example, a cashier sees billing, consents and PhilHealth only, and a physician sees everything except billing,
PhilHealth, dental images and records requests. When some kinds are hidden, the timeline says "Some records are not shown to you because your role does not
include access to them."

The **Recent activity** card on the patient record shows the latest five entries. Viewing the timeline is recorded in the audit trail.

## How to record PhilHealth eligibility answers

The platform records what PhilHealth answered. It does not decide eligibility, and it is not connected to PhilHealth: the card says "Not connected to
PhilHealth. Check through PhilHealth's own channel, then record its answer and reference here."

1. Select your facility in the top bar.
2. Check the patient's eligibility through PhilHealth's own channel.
3. In **PhilHealth eligibility**, enter the **Date of service**, **PhilHealth's answer** (**Eligible**, **Not eligible** or **Undetermined**), the
   **Reference** PhilHealth gave, and an optional **Note (optional)**.
4. Select **Record answer**.

Recorded answers never change. The card lists the latest five, each marked "PhilHealth's channel". To correct one, record a new answer. The PhilHealth claim
panel on an invoice shows the latest answer for the dates of service, as information only (see [Billing](10-billing.md)).

An **Ask PhilHealth** button appears only if your organization has connected a PhilHealth eligibility adapter. None is connected by default.

If you don't see this card, you need the `philhealth.eligibility.manage` permission (receptionists and cashiers by default).

## How to record the patient's YAKAP registration

The platform records PhilHealth's answer about the patient's YAKAP registration. It encodes no YAKAP rules and sends nothing to PhilHealth ("Not connected to
PhilHealth YAKAP (no official specification yet).").

1. Select your facility in the top bar. The card shows the **Latest answer for this facility** and the facility's YAKAP reference (set in billing settings).
2. Ask through PhilHealth's own channel.
3. Choose **PhilHealth's answer**: **Registered**, **Not registered**, **Pending** or **Unknown (no clear answer)**.
4. Enter the **Effective date (if given)**, the **Reference** (optional only for Unknown) and an optional **Note (optional)**.
5. Select **Record answer**.

Open **History** to see earlier answers, including those of other facilities. Answers are never changed; record a new one instead.

Users with `philhealth.claim.submit` (cashiers by default) also see **Encounter packages** — the patient's consultations. Select **Package** to open the
**YAKAP encounter package** for a consultation. It is prepared from this platform's records and is not a PhilHealth form. A checklist shows what is recorded and
what is missing. Nothing is sent from here: "The official PhilHealth specification has not been obtained, so nothing is sent from here. Use PhilHealth's own
channel for this consultation."

If you don't see the YAKAP card, you need `philhealth.eligibility.manage` or `philhealth.claim.submit`.

## How to find laboratory results and reports on the record

- **Laboratory results** lists released results by test: **Latest** value, **Reference** range and **Collected** time. A critical result has a critical icon.
  A corrected result shows "Corrected:" with the reason, and a result from a reference laboratory shows who performed it. Select **Trend (n)** to see earlier
  values of a test (no chart is drawn when units differ). Paperclip links open result attachments. Under **Printable reports**, select an order number to
  open its current report.
- **Archived laboratory reports** lists the copy of each report as it was released: **Order**, **Version**, number of **Results** and **Archived** time. A
  correction adds a new version ("includes a correction") and earlier versions stay available. Select **Open PDF** to read one. A report may show **Being
  archived** for a short time after release, or **Archiving failed** (tell the laboratory or your administrator).

You need `lab.result.read` to see results, and also `lab.order.read` for archived reports. Opening results and reports is audited. See
[Laboratory](06-laboratory.md).

## Documents on the record

There is no general document upload or document list on the patient record yet. Documents appear where they belong:

- Signed consent forms — in **Consent & communication** (**Signed form**).
- Laboratory reports and result attachments — in the laboratory sections above.
- Dental radiographs and photos — in the dental record ([Dental](08-dental.md)).
- Uploaded documents appear in the timeline under **Documents**, by category only.

Document links are short-lived and each opening is recorded in the audit trail.

The timeline includes the entries of every record merged into this patient; each says **Filed under P…** after its details. The timeline of a merged
(retired) record opens the surviving record's timeline.

## How to record immunizations

Staff with `immunization.read` see an **Immunizations** card on the patient record (the latest five) and the full history at **Open history**
(`/patients/[id]/immunizations`), grouped by vaccine. Each dose shows when it was given (as precisely as known: a year, a month, a day or a
time), the dose as recorded, **Given**, **Not given** or **Entered in error** (colour, icon and words), and where it came from: **Given here**,
**Reported** or **Imported**.

The history is a record of what was given. It does **not** say which vaccine or dose is due: use your clinical judgement and your
organization's protocol.

With `immunization.record` (physicians and nurses by default):

1. **Record dose given here** (select your facility first). Choose the **Vaccine** from your organization's catalogue and **Given** or **Not
   given**.
   - **Given:** choose the lot **From stock** (the lot number and expiry are filled in and one unit leaves stock when you save) or type the
     **Lot number** (required) and **Expiry** (not before the day given). Add the dose, route and site (from the catalogue's lists), amount
     and unit, and any reaction you observed. Leave **Date given** empty for now.
   - **Not given:** choose why (**Refused**, **Contraindicated**, **Vaccine unavailable**, **Other reason**) and write it in your words
     (required for "Other reason").
2. **Record reported dose** for a dose given elsewhere (a vaccination card, the patient's recall): the vaccine from the catalogue or its name as
   written, **When given** as `2019`, `2019-05` or `2019-05-12`, the dose as written, who gave it or where, **Where the information comes
   from** (required), and optionally a scan: choose one on file or **Upload a scan**.
3. A reaction noticed later: **Add reaction…** on the dose (once). It does not create an allergy — if the reaction means an allergy, record it
   in **Allergies** (**Record an allergy if appropriate** opens the record).
4. A mistake: **Entered in error…** with a reason. The dose stays listed, struck through; a dose taken from stock goes back to its lot. Record
   the correct dose again. Records are never edited or deleted.

Doses filed under a record merged into this one say **Filed under P…**; new doses are recorded on the surviving record. Doses accepted from an
imported record are marked **Imported** (see [Records, reporting and integrations](11-records-reporting-and-integrations.md)).

## How to record the medical, medication, family and social history

Staff with `history.read` see a **Medical, medication, family and social history** card on the patient record (the family history state, past
procedures and conditions, medicines from elsewhere, tobacco and alcohol use) and the full history at **Open history** (`/patients/[id]/history`). It holds what the patient, a relative or
another provider told you, or what you documented from records you saw. It is **not** a diagnosis: past conditions here are never on the problem
list, never billed and never reported. Nothing in it is scored.

With `history.record` (physicians, nurses and dentists by default):

1. **Add procedure** — a past operation or procedure: its name, **When** as `2019`, `2019-05` or `2019-05-12` (or empty when not known), where or
   by whom, the side or body site, an optional code of your organization's code system, and the **Source**: **Reported to us** (say who: the
   patient, a relative or another provider) or **Documented here** (for example from a discharge summary the patient brought).
2. **Add condition** — an illness diagnosed elsewhere, with **Since** and its **Status as reported** (still present, resolved, not known). To make
   a diagnosis yourself, record it in the consultation instead.
3. **Add medicine** (under **Medications taken (not prescribed here)**) — a medicine the patient takes that your clinic did not prescribe:
   prescribed by another doctor, bought over the counter, a vitamin or a herbal remedy. Write the medicine as the patient names it (for example
   "Losartan 50 mg tablet", "Lagundi syrup"), **How taken**, **What for**, **Prescribed by / from where**, **Still taking?** (taking, stopped, not
   known), **Since**, and for a medicine already stopped, **Stopped** (a year or month is fine). It is **not** a prescription: it is not
   dispensed, billed or checked against allergies. When the patient later stops a medicine, choose **Mark stopped…**, give when (if known) and
   an optional note, and **Confirm stopped** — this can be done once. A stop date before the start date is refused.
4. **Add relative's condition** — the relative from the list (**Other relative** needs who), the condition, the age it began, and whether the
   relative has died (with the cause, as reported).
5. The family history state is shown with colour, icon and words: **Family history not recorded — ask the patient**, **No known family history**
   (only after you record it), **Family history not known** (adopted, not known to the patient, or declined to answer) or **Family history
   recorded**. After asking, choose **No known family history**, **Reviewed: complete as listed** or **Not known…** with the reason.
6. **Record social history** (or **Record new version**) — tobacco (never, former, current, not known; type, amount per day, year stopped),
   alcohol (and how often), occupation and exposures at work, living situation, physical activity, diet and notes, **As of** a date (empty for
   today). The form starts from the current version; each save is a new version and earlier versions stay listed under **Earlier versions**. If
   someone else saved a version while you were typing you are asked to reopen the page.
7. A mistake: **Entered in error…** with a reason. The entry stays listed, struck through; for the social history the previous version becomes
   current again. Nothing is edited or deleted.

**Other substance use** and **Sexual history** are private (a lock icon). Only staff who also hold `encounter.write` (physicians and dentists by
default) see and change them; others see "Substance use and sexual history are not shown to you", and a version they save keeps those parts
unchanged. They never appear in the timeline, messages or search. The patient sees them in MyHealth; a guardian acting for the patient does not.

Entries filed under a record merged into this one say **Filed under P…**; entries accepted from an imported record are marked **Imported**.

## External history (imported)

If records from another provider were imported and accepted, **External history (imported)** lists them, each marked **External** with its kind (Condition,
Observation, Medication, Document), where it came from and when it was accepted. These are not this clinic's own diagnoses, results or prescriptions.

Users with `interop.fhir.import.review` can mark an entry **Entered in error…** with a reason. See
[Records, reporting and integrations](11-records-reporting-and-integrations.md).

## Rules the system enforces

- One patient, one record: registration is refused when an identifier is already used by another patient, and possible duplicates must be reviewed one by one
  with a reason.
- A patient is registered at a facility; a facility must be selected.
- Birth date cannot be in the future. The mobile number must be a Philippine mobile number. The PhilHealth PIN must have 12 digits (its check digit is not
  verified).
- Search needs at least 2 characters or a birth date, and shows only minimal details with a masked mobile number.
- Allergies are never edited or deleted: they are resolved, marked no longer relevant, or marked entered in error, always with a reason.
- "No known allergies" cannot be recorded while an active allergy is listed.
- Consent is append-only. An end date is allowed only for granted consent.
- A MyHealth invitation needs an active patient and granted portal consent. Only the latest code works, for 72 hours.
- PhilHealth eligibility and YAKAP answers are immutable history and need PhilHealth's reference (except a YAKAP "Unknown").
- Every view of a record, timeline, consent history, result or document is recorded in the audit trail.
- A merged (retired) record is read only: new appointments, visits, allergies, consultations, orders, prescriptions, care plans, dental records and uploads go
  to the surviving record. Corrections to what is already filed under it stay possible.

## Troubleshooting / common messages

| Message                                                                                      | Meaning                                              | What to do                                                                    |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| Enter at least 2 characters.                                                                 | The search text is too short.                        | Type more, or add a birth date.                                               |
| You don't have permission to search patients.                                                | Your role lacks `patient.search`.                    | Ask your administrator.                                                       |
| Select your facility in the top bar first. Patients are registered at a facility.            | No facility selected.                                | Choose your facility in the top bar.                                          |
| Check the highlighted fields.                                                                | A field is missing or invalid.                       | Correct the fields marked in red.                                             |
| Enter a PH mobile number, e.g. 0917 123 4567                                                 | The mobile number is not a Philippine mobile number. | Enter it as 09XX XXX XXXX or +639XXXXXXXXX.                                   |
| PhilHealth PIN has 12 digits                                                                 | The PIN is incomplete.                               | Check the member's PhilHealth ID.                                             |
| Possible duplicate patients found. Review them before registering.                           | Similar records exist.                               | Review each candidate as described above.                                     |
| An identifier is already assigned to another patient                                         | Another record has the same identifier.              | Use the existing record.                                                      |
| This allergy is already recorded                                                             | The same substance is already active.                | Review the existing entry instead.                                            |
| Resolve or correct the recorded allergies before recording "no known allergies"              | An active allergy is still listed.                   | Resolve or mark it entered in error first, if appropriate.                    |
| The end date must be after today. / Only a granted consent can have an end date.             | Invalid consent end date.                            | Change or clear **Ends on**.                                                  |
| Attach a PDF or a photo (JPEG, PNG or HEIC). / The file is larger than 10 MB.                | The signed form cannot be uploaded.                  | Scan as PDF or at a lower resolution.                                         |
| The signed form was saved, but the consent was not recorded: …                               | The upload worked; saving the decision failed.       | Select **Save consent** again; the form is linked without uploading it again. |
| Allow pop-ups to view the signed form.                                                       | The browser blocked the new tab.                     | Allow pop-ups for the staff app.                                              |
| This record was merged into another patient; use the surviving record instead                | You opened a merged (retired) record.                | Open the surviving record from the banner and work there.                     |
| Record the patient's portal access consent before inviting them                              | Portal consent is not granted.                       | Record the consent first.                                                     |
| This patient already has an active portal account                                            | The patient has already signed up.                   | No invitation needed.                                                         |
| Not delivered: the patient has no active MyHealth account or has turned off in-app messages. | The message was not delivered.                       | Contact the patient another way.                                              |
| Enter the reference PhilHealth's channel gave.                                               | The PhilHealth reference is missing.                 | Enter the reference number from PhilHealth.                                   |
| Patient was modified by someone else (expected version …). Reload and try again.             | Someone changed the record at the same time.         | Reload the page and repeat your change.                                       |
| Some records are not shown to you because your role does not include access to them.         | Your role cannot see some kinds on the timeline.     | This is expected. Ask a colleague with access if you need that information.   |

## Related chapters

- [Getting started](01-getting-started.md)
- [Appointments and queue](03-appointments-and-queue.md)
- [Consultations and care plans](04-consultations-and-care-plans.md)
- [Laboratory](06-laboratory.md)
- [Dental](08-dental.md)
- [Billing](10-billing.md)
- [Records, reporting and integrations](11-records-reporting-and-integrations.md)
- [Patient portal (MyHealth)](12-patient-portal.md)
- [Administration](13-administration.md)
