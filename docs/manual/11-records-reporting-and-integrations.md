# 11. Records, reporting and integrations

**What this is for.** This chapter covers merging duplicate patient records and the work that connects the clinic to the outside: reviewing health
records other providers send in (FHIR imports), reviewing disease case reports for the Department of Health (DOH), preparing PhilHealth YAKAP
consultation packages, and — for administrators — reviewing requests the platform sends to external systems and the keys that protect them. It ends
with a short note on the FHIR read interface other systems can use.

**Who uses it.**

- **Records officers** and organization administrators: merging duplicate patient records (`patient.merge`), patients' records requests
  (`/records/requests`) and record imports (`/records/imports`).
- **Physicians**, records officers and organization administrators: disease case reports (`/reporting`).
- **Receptionists**, records officers, physicians, dentists and organization administrators: the communication log (`/communications`).
- **Organization administrators**: reportable-condition settings (`/reporting/settings`) and integration review (`/admin/integrations`).
- **Platform administrators** (the people who run the platform's servers): payload encryption keys.

**Important — what is and is not connected.** No government system is connected. There is no official specification on record for PhilHealth
eClaims, PhilHealth eligibility, PhilHealth YAKAP or DOH reporting, so the platform sends nothing to them. You prepare and check the information in
the platform, report or file it through the agency's own channel, and record the reference the agency gives you. The **Submit** / **Send** buttons
for these only appear once an adapter for the official specification is configured.

## How to merge duplicate patient records

When the same person was registered twice, merge the two records so every screen shows one history. **Nothing is moved or rewritten**: the record
you retire keeps everything filed under it (consultations, results, prescriptions, bills, documents), becomes read only, and every screen of the
surviving record shows it, each row marked **Filed under P…**. That is also why a merge can be undone exactly.

**Who:** records officers and organization administrators (`patient.merge`).

### Choose the two records

1. Open one of the two patient records and select **Merge duplicate…**.
2. Search for the other record (name, patient number or mobile).
3. Decide which record survives — usually the one the patient uses (MyHealth account, PhilHealth PIN, most recent visits) — and select **Keep P…**
   on that side. The other record will be retired.

### Compare and resolve what is in progress

The **Compare and merge** page shows both records side by side: name, birth date, sex, status, identifiers, contacts, MyHealth account, consent,
registration and records already merged into either. Rows that differ say **Differs**.

Under **Work in progress**, the record to retire must have nothing still going on, because nothing new can be filed under a retired number and no
reminders are sent to it. Each item links to the screen that resolves it:

| Item                                    | What to do                                               |
| --------------------------------------- | -------------------------------------------------------- |
| Consultation or online consultation     | Sign it (or mark it entered in error); end an online one |
| In the queue                            | Finish or cancel the visit                               |
| Upcoming appointment                    | Cancel it and book it again under the surviving record   |
| Laboratory order not finished           | Release the results or cancel the remaining tests        |
| Draft invoice / charge not yet invoiced | Issue or cancel it                                       |
| Deposit or credit balance               | Apply it to an invoice or refund it                      |

An **active care plan** is only a note: it stays under the retired number and is shown on the surviving record, but its reminders are no longer sent.
Consider closing it and starting one on the surviving record. An **open referral** is also only a note: it stays under the retired number (its letter
names it) and is shown with the surviving record; answers and replies are still recorded on it, but no new referral can be made under the retired
number. Reload the page after resolving the items.

The page also says what happens to MyHealth: if only the retired record has an account, it moves to the surviving record (the patient signs in
again; the surviving record's portal consent applies). If both have one, the retired record's account is disabled.

### Merge

1. Tick each flagged difference (for example a different birth date, or one record marked deceased) after checking it is the same person.
2. Enter the **Reason** (at least 5 characters), for example "Same person registered twice (PhilSys ID checked)".
3. Type the retired patient number to confirm, and select **Merge P… into P…**.

The surviving record opens. It lists the retired number under **Merged records** with the merge history. Opening the retired record shows **Merged
into P… on … by …** with a link. Searching for the retired number, its mobile number or an identifier finds the surviving record. The merge is
recorded in the audit trail with your reason.

If a record already had other records merged into it and is itself merged, those records now point to the new surviving record too.

### Undo a merge

On the surviving record, under **Merged records**, select **Unmerge…** next to the retired number, give the reason and confirm. The retired record
gets its previous status and everything filed under it back as a separate patient; a MyHealth account moved at the merge moves back. What was
recorded on the surviving record **after** the merge stays there — check it and correct anything that belongs to the other person.

## How to answer patient messages

Patients write to the clinic in MyHealth (**Messages → New message**). They are told messages are read during clinic hours, are not for urgent problems, and
are not for emergencies. Choose **Patient messages** in the menu (needs `patient.message.read`; replying needs `patient.message.manage`).

1. The list opens on **Waiting for us**: open conversations where the patient wrote last, the longest wait first, with how long each has waited and, where
   the clinic set a target, **due in …** or **… past target** (marked ⚠). Use **Open**, **All**, **Closed**, **Assigned to me**, or a patient's own
   conversations from the patient record.
2. Select **Reply** to open a conversation. Opening one is audited. Read it, write your reply in plain words and select **Send reply**. Sending takes the
   conversation for you if nobody has it. **Assign to me** and **Release** move it between colleagues.
3. Files the patient sent (photos, PDFs) appear under their message; select one to open it (each opening is recorded). To send a file back, choose
   **Attach files** before **Send reply**: up to 3 images or PDFs of 10 MB or less, filed in the patient's record as attachments.
4. **Internal notes** on the right are for the clinic only — the patient never sees them, and they cannot be edited or deleted. Use them to record who you
   checked with or what to do next.
5. The patient is sent a text or email saying **a message is waiting** — never what it says. You are notified in the app when a patient writes (once for a run
   of messages), and once more if a conversation passes its response target.
6. When the question is settled, select **Close conversation**. The patient can still read it but cannot add to it; **Reopen** it if needed.

**Routing and response targets** (needs `clinic.configure`; **Routing and response targets** above the list, for the facility selected in the top bar): for
each topic a patient can write about, choose who is told of a new message — everyone who can reply, everyone with a role, or one person (optionally
**assigned on arrival**) — and **Answer within** so many hours (1–168, calendar hours; clinic hours and holidays are not taken into account). Past the
target the conversation is marked and the responsible people get one reminder in the app.

If a message describes something urgent, **call the patient**; do not answer an emergency by message. Do not put results or urgent instructions in a reply.
Nothing said here is a diagnosis by the system: a reply is the clinician's own. Where the organization runs the malware scanner, every file a patient sends is
scanned before it is accepted and an unsafe one is never shown; without the scanner, files are marked "not scanned" — open them as you would any file from
outside.

## How to answer a patient's records request

Patients ask for copies of their records in MyHealth (**Documents**). You need `patient.records-request.manage` (records officers and organization
administrators). You get a message under the bell for each new request.

1. Open **Records** → **Requests**. Open requests are listed oldest first, with how long each has waited.
2. Open one to see what the patient asked for (consultation records, laboratory results, prescriptions, dental records, X-rays and images,
   medical certificates or something else), the period, details and purpose. Opening it is recorded.
3. Select **Take into review** so colleagues see someone is working on it (optional).
4. Confirm the requester as your organization's Data Privacy Act procedures require. The platform encodes no deadline, fee or disclosure rule.
5. To give a copy of the record itself, use **Copy of the record** (below the request): the sections matching what the patient asked for and the
   request's period are already filled in. Tick or untick sections (allergies, consultations, laboratory results, prescriptions, care plans, dental
   treatment, medical certificates, documents on file, immunizations, medical, family and social history), change the dates if needed (leave them empty for the whole record), and select **Prepare
   copy**. The platform compiles one PDF and stores it in the patient's record; select **Open** to check it. It is not sent to the patient yet.
6. To share copies: upload scans to the patient's record first if they are not there (see [Patients](02-patients.md)), tick the documents under
   **Documents to share** (including a copy of the record you prepared), add a **Note to the patient** if useful, and select **Share**. The patient
   downloads them in MyHealth.
7. To decline: select **Decline…**, write the reason in words the patient will read, and select **Decline request**.

If your organization requires it, write **How the requester's identity was confirmed** before sharing; sharing is refused without it.

The patient is told by message (and SMS or email) that the request was answered, without details. An answered request cannot be changed; the patient
can send a new one. Patients can have at most 3 open requests and can withdraw an open one.

**What a copy of the record contains.** Only the record as it stands: signed consultation notes (as last amended, never drafts) with diagnoses and
vital signs, laboratory results that have been released, issued medical certificates (listed; each is its own document) and a list of documents on
file (the files themselves are shared separately). Drafts, consultations still in progress and entries marked as made in error are left out; records
received from other providers are labelled. Allergies and the medical, family and social history are always as they stand now (the history
includes its private parts: the copy answers the patient's own request). Dates follow your facility's time zone. Preparing a copy is
recorded. Billing records and dental charts are not included; whether a copy must be signed or certified is your organization's procedure.

### Your records-request procedure

**Records → Requests → Your procedure** (`/records/requests/settings`) holds your organization's own procedure; administrators change it:

- **Respond within (days)** — each new request gets a response date. Open requests past it are marked in the list and on the request, and
  patients see the date in MyHealth.
- **Record how the requester's identity was confirmed** — staff must write how they checked it before sharing.
- **What patients read before asking** — your own words on fees, identification to bring and how answers are given, shown in MyHealth above
  the request form.

Nothing here is a National Privacy Commission rule. Have your Data Protection Officer check it and record the review under **Admin → Compliance**.

## How to set document retention periods

Open **Records → Retention** (`/records/retention`; records officers and administrators).

1. Under **Retention periods**, choose a **Document category**, enter **Keep for (years)** from your organization's retention schedule and say
   **Where the period comes from**. Click **Save**. A new period for the same category replaces the old one (kept in the history).
2. The table shows how many documents of each category are older than the period. Click the number to list them, oldest first, with a link to
   each patient record.
3. Nothing is deleted. To take a document out of use, archive it from the patient record with a reason. Disposal of the stored file follows
   your organization's own procedure.

## How to review records sent by another provider (FHIR imports)

Other systems can send a patient's records to the platform in the FHIR format. **Nothing is added to a patient's record automatically.** Every
import waits in a review queue until someone matches the patient and accepts or rejects each entry.

### Open the queue

1. Go to **Records → Imports** (`/records/imports`).
2. **To review** (the default) shows imports still waiting; **All recent** shows the others too.
3. Each row shows when it was **Received**, **From** (the source the sender declared — not verified), **Content** (for example "1 Patient, 2
   AllergyIntolerance"), the matched **Patient** ("Not matched" until you match one), and the **Status** with the number of entries to review.
4. Click **Review** (or **Open** for a finished import).

If you don't see **Records** in the menu, you need the `interop.fhir.import.review` permission — ask your administrator. Records officers and
organization administrators have it by default.

Opening an import is audited.

### Match the patient

The **Patient** card shows the patient **As sent** on the left and the **Matched patient** on the right. Until you match, the page says "Not matched
yet — entries cannot be accepted until you match the patient."

1. Look at **Possible matches (duplicate detection)**. Each candidate shows a level (certain, high, …), the patient number, birth date and why they
   matched. Click **Match** on the right person.
2. If there is no good candidate, type a name or patient number in **Search by name or patient number** and click **Search**, then **Match** the
   right result. (Searching needs `patient.search`.)
3. If the patient is new to the clinic, click **Register as a new patient**. This uses the normal registration with its duplicate check. If
   possible duplicates are found, you see "Possible duplicates — check these first. If one is the same person, match them instead." Either click
   **Match this patient**, or explain **Why is the imported patient a different person?** and click **Register anyway**. Registering needs
   `patient.register` and a selected facility.

The match can be changed until the first entry has been accepted for that patient. The patient's existing demographics are never changed by an
import.

### Accept or reject each entry

Each entry under **Entries** shows its type, its content in readable form, any notes (warnings in amber), and what accepting will do:

| Received                                              | Button                         | What accepting does                                                                                            |
| ----------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| AllergyIntolerance                                    | **Accept as allergy**          | Records an allergy, always **unconfirmed** and marked as from an external source ("External record")           |
| Condition, Observation, medication, DocumentReference | **Accept as external history** | Adds it to the patient's **External history (imported)** — not a diagnosis, result, vital sign or prescription |
| Immunization                                          | **Accept as immunization**     | Adds it to the patient's immunizations, marked **Imported**                                                    |
| Procedure (done)                                      | **Accept as past procedure**   | Adds it to the patient's past procedures (medical history), marked **Imported** — not a procedure done here    |
| FamilyMemberHistory                                   | **Accept as family history**   | Adds each of the relative's conditions to the patient's family history, marked **Imported**                    |
| Any other type                                        | —                              | Shown as **Not supported for import**; cannot be accepted                                                      |

1. Read the entry and its notes. Accept only what you would record yourself.
2. Click the accept button, or click **Reject…**, give a **Reason** (at least 3 characters) and click **Reject**.
3. To close the import, click **Reject the rest…**, give a reason (for example "not our patient") and click **Reject remaining entries**.

The import's status becomes **Accepted**, **Partly accepted** or **Rejected** once no entry is left to review. For documents, only the description
is recorded — the file itself is not fetched.

### Correct a mistaken acceptance

Nothing is deleted. On the patient record:

- An accepted **allergy** is marked entered in error from the allergy list (needs `allergy.manage`; see [Patients](02-patients.md)).
- An **External history (imported)** entry is marked with **Entered in error…**, a **Reason**, and **Confirm** (needs `interop.fhir.import.review`).

### Retention

When an import is rejected, the content that was received is deleted 30 days later. The import, its entries and the decisions stay; the page then
says "The received content was deleted by the retention rule for rejected imports; only the decisions remain." Accepted imports keep what was
received as proof of what was accepted.

## How to review disease case reports (DOH)

The platform does **not** contain a list of notifiable diseases, case definitions or deadlines. Your organization configures which diagnoses are
reportable. When a doctor records a diagnosis whose ICD-10 code matches one of your rules, a **case report** opens for review.

### Open the case reports

1. Go to **Disease reporting** (`/reporting`).
2. Filter with **All**, **To review**, **Reported**, **Not sent**, **Dismissed**.
3. Each row shows when it was **Detected**, the patient, the **Condition** (your category), the diagnosis code and the **Status**. A case found by a
   check of earlier diagnoses carries the badge **Earlier diagnosis**.
4. Click the detection date to open the case.

Statuses: **To review**, **Sending**, **Reported**, **Rejected**, **Not sent**, **Dismissed**.

If you don't see **Disease reporting**, you need `doh.report.manage`. Physicians, records officers and organization administrators have it by
default.

### Review and decide

The **Prepared report** shows the condition, diagnosis (with certainty), consultation, patient identity, address, contact number and facility with
its DOH health facility code. The checklist shows what is missing from the clinic's own records:

- The diagnosis stands (not entered in error or refuted)
- The facility's DOH health facility code is recorded
- The patient's address (city or municipality) is recorded

"This is the clinic's own summary, not an official DOH form."

Under **Decision** (while the case is To review, Rejected or Not sent):

1. **DOH reporting is not connected.** Report the case through DOH's own channel.
2. Type the **Reference from DOH's channel** and click **Record as reported**.
3. Or, if the case is not reportable after review, enter the reason under **Not reportable after review — reason** and click **Dismiss**.

**Submit to DOH** appears only once a DOH adapter is configured.

## How to configure reportable conditions (DOH settings)

Go to **Disease reporting → Reportable conditions** (`/reporting/settings`). You need `doh.settings.manage` (organization administrators by
default).

### Add a rule

1. Under **Rules**, enter the **ICD-10 code** or prefix. A prefix covers everything under it: `A9` covers A90–A99; `A91` covers A91 and A91.x.
2. Enter the **Category** in your organization's own wording, and the **Source (issuance)** you took it from.
3. Optionally enter **Report within (days)**: your organization's own deadline, counted from when the diagnosis was recorded. Case reports from
   the rule then show when they are due, and **Overdue** once past it while still unreported. No deadline is suggested.
4. Click **Add**.

Take the list and categories from the official issuances your facility follows. Nothing is reportable until you add it. A rule cannot be edited:
click **Deactivate** and add a new one. Existing case reports keep the rule they matched.

### Record the facility code

Under **DOH health facility code**, enter the **Facility code** DOH issued for the selected facility and click **Save**. It is used on case reports
and is not verified with DOH.

### Check earlier diagnoses

Rules only apply to diagnoses recorded after you add them. To catch diagnoses recorded before:

1. Under **Check earlier diagnoses**, choose **Recorded from** and **to** (at most 90 days, not in the future). Dates are read in the selected
   facility's time zone (Asia/Manila unless your facility is set otherwise).
2. Click **Check**. The check runs in the background; the page updates every few seconds.
3. Each check shows its status (**Waiting**, **Checking**, **Done**, **Failed**) and counts: coded diagnoses checked, how many matched a rule, and
   how many case reports were opened.

A diagnosis never gets a second case report, so re-checking a range is safe. Only one check runs at a time. You need at least one active rule
("Add a rule first.").

## How to prepare a PhilHealth YAKAP consultation package

No YAKAP benefit package, capitation, eligibility or first-patient-encounter rule is built in. The platform prepares a summary of a signed
consultation from its own records.

1. Open the patient record. In the **PhilHealth YAKAP** card, under **Encounter packages**, click **Package** next to the consultation.
2. The page (`/patients/[id]/yakap/[encounterId]`) shows the consultation, what the package contains (patient, member PIN, clinician, diagnoses,
   prescriptions, laboratory orders) and a checklist, for example "The patient's PhilHealth identification number is recorded" and "The consultation
   has an ICD-10 coded diagnosis". "The package is prepared once everything in the checklist is recorded."
3. **YAKAP not connected.** Use PhilHealth's own channel for this consultation. **Send to PhilHealth** appears only once an adapter is configured.

This needs `philhealth.claim.submit` (cashiers and organization administrators by default). The facility's YAKAP participation reference is
recorded in billing settings ([Billing](10-billing.md)); a patient's YAKAP registration answer is recorded on the patient record
([Patients](02-patients.md)). PhilHealth claims from invoices are in [Billing](10-billing.md#how-to-prepare-a-philhealth-claim).

## How to review integration exchanges (administrators)

When an adapter for an external system is configured, the platform prepares each request (a PhilHealth claim, eligibility check or YAKAP package,
a DOH case report) and a background worker sends it, retrying automatically. **Administration → Integrations** (`/admin/integrations`) shows the
ones that did not succeed. Until any adapter is configured, this page normally shows "Nothing needs attention."

You need `integration.exchange.manage` (organization administrators by default).

1. **Needs attention (n)** lists requests that ended **Failed**, **Rejected** or **Not connected** and are not yet resolved, and queued ones that
   are **Stalled** (not picked up within 10 minutes, or no attempt for 30 minutes). **All recent** shows the rest. The line below summarises
   unsuccessful, stalled and queued counts.
2. Each row shows when it was requested, **What** (for example "PhilHealth claim", "DOH case report"), the patient, the status with the number of
   attempts, and **Details** (the external reference, reason codes and the last error). The request content itself is never shown.
3. Use the link under **What** — **Open invoice**, **Open case report**, **Open patient record** or **Open YAKAP package** — to fix the cause at
   the source.

Actions:

- **Re-queue** — for a stalled request whose prepared content is still held. It goes back on the queue.
- **Resolve…** — for an unsuccessful request: type **What was done** (for example "checked through PhilHealth's own channel instead") and click
  **Save**. The request's outcome does not change; your note is recorded.
- **To retry a final failure**, go to the source (invoice, case report, patient record) and submit again there. The platform prepares a fresh
  request from the current record.

## Payload encryption keys (platform administrators)

Prepared requests waiting to be sent, and the content of FHIR imports, are stored encrypted. Platform administrators see a **Payload encryption
keys** table at the bottom of `/admin/integrations`, across all organizations: **Key id**, **State**, **Queued payloads** and **Stored FHIR
imports** (counts only).

| State                                        | Meaning                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| **Current**                                  | New values are encrypted with this key                                            |
| **Still needed**                             | Stored values still use this key; keep it configured                              |
| **Not needed — can be removed**              | Nothing uses it any more                                                          |
| **Missing — stored values cannot be opened** | Stored values use a key the servers no longer have; restore it if it still exists |

Changing keys is a server operation, not a screen action. Follow the runbook `docs/runbooks/integration-payload-key-rotation.md`. Accepted FHIR
imports keep their content, so an old key is often still needed for them.

## FHIR read access for other systems (brief)

Other systems (for example a referral hospital's system) can read a patient's record in FHIR R4 format through the API at `/api/v1/fhir/r4`:
`Patient/{id}`, `Patient/{id}/$everything`, and searches of one resource type by patient (`{Type}?patient={id}`). There is no screen for this.

- The calling account needs `interop.fhir.read`. Only organization administrators have it by default; give it deliberately to a dedicated role for
  an integration account.
- Documents also need `document.read`; the dental record also needs `dental.record.read`.
- Only **released** laboratory results are exported. Imported allergies and external history are exported marked as from an external source.
- Referrals are exported as referral requests (`ServiceRequest`), with the urgency (an emergency referral as the highest priority, "stat").
- Every access is audited with the patient and what was returned.
- Other systems send records in through `POST /api/v1/fhir/r4/imports` (`interop.fhir.import`); these land in the review queue described above.

Technical details are in `docs/interoperability/fhir.md`.

## How to check what was sent to patients (communication log)

**Communications** in the menu (`/communications`, `notification.read`) lists the reminders, notices and MyHealth alerts sent — or held back — to
patients across the organization, newest first. Messages to staff (the bell) are not part of it. The content of messages is never shown.

1. Choose the period (**From** / **To**, days in the Philippines; up to 92 days — a longer period is shortened to its last 92 days, with a note)
   and, if you like, a **Status**, **Channel**, **Kind** (care; appointments and admin; reminders and outreach; account security) and **Message**,
   then **Show**. The period starts as the last 7 days.
2. The figures show how many messages there were, how many were sent or delivered, how many were **not sent, failed or cancelled**, and how many are
   waiting. Below them: counts by channel, **Why messages were not sent** (for example "No mobile number on record", "The patient turned this
   off") and the most frequent messages — select one to list only those.
3. The list shows when, the patient (select to open their communication history), the message, the channel with the number or address partly
   hidden, the status (colour, icon and words; the reason when not sent; the attempts when failed) and who asked for it (**Automatic** when the
   platform sent it on its own).
4. **Download CSV** saves the same list (up to 5,000 messages; narrow the filters for more). Keep the file as confidential as the patient record.

Showing the list and downloading it are recorded in the audit log. Staff without `patient.read` see only the figures, not the patients.

Typical uses: a patient says they got no reminder (filter by the patient from their record, or look for **Not sent**); many reminders are "not
sent" for lack of a mobile number (update contact details at registration); a provider is failing (many **Failed** on one channel — tell your
administrator).

## How to read the management dashboard

**Who:** organization administrators (`management.dashboard.read`; a grant at one facility shows only that facility). Revenue figures also need
billing report access (`billing.report.read`) for every facility shown.

1. Open **Management** in the menu (`/management`).
2. Choose **From**, **To** and a **Facility** (or **All facilities**), or a quick range such as **Last 30 days**, and select **Apply**.
3. Read the key figures. Under each one:
   - the change against the previous period of the same length, with **(better)** or **(worse)** — for example, a lower no-show rate is better, a
     longer wait is worse;
   - **How is this calculated?** explains exactly what is counted.
4. Scroll for the daily charts (each has **Show as table**) and the tables: services, revenue by category and payment method, providers with schedule
   utilization, laboratory tests and instruments, dental procedures, online consultations and patient retention.
5. To download a table, select its name after **Download CSV**. The file opens in a spreadsheet; amounts are in pesos.

**Things to know:**

- **"<5"** means between one and four patients. Small patient counts are hidden so that no one can be recognized, and a percentage built on
  such a count shows as **withheld**.
- Without billing report access, a note replaces the revenue figures and the revenue downloads are refused.
- These are operational figures, not DOH, PhilHealth or BIR reports. Every view and download is recorded in the audit trail.

## How to send an outreach campaign

**Who:** organization administrators (`crm.segment.manage`, `crm.campaign.manage`; approval needs `crm.campaign.approve` and a second person).
Records officers can read segments and campaigns.

1. Open **Outreach** in the menu (`/outreach`).
2. Under **Segments**, select **New segment** and choose who matches: age range, sex, city or province, when they registered, when they last
   visited (or no visit for a number of months), a care-plan activity due soon, or an opt-in to a channel. Every filled criterion must hold.
   **Preview** shows how many patients match today and a short work list; every preview is recorded in the audit trail.
3. Under **Campaigns**, select **New campaign**: the segment, the channels, a subject (for email and MyHealth), the message in plain text, and
   optionally when to send. The screen shows the length allowed for the chosen channels. Save the draft and select **Submit for approval**.
4. **Someone else** opens the campaign and selects **Approve**. The system refuses an approval by the person who wrote or submitted it.
5. The campaign is sent at its time, or within a minute. Open it to see the **Result**: how many patients were in the segment, and per channel
   how many messages were queued, delivered, not sent or failed, with the reasons (for example "No outreach opt-in on this channel").

**Things to know:**

- A message goes out only on a channel the patient has **opted in to for outreach** (MyHealth → Notification settings, or recorded at the
  clinic). Deceased, merged and inactive records are never contacted. Messages about care, appointments and bills are not affected.
- Segments cannot use diagnoses, results or medications. Do not put anything about a person's health in a campaign message.
- Every outreach email carries a link the patient can use to stop outreach on that channel; it is recorded on their record.
- A campaign cannot change once approved: cancel it with a reason and draft a new one. Who received what appears in **Communications**.

## How to schedule a weekly or monthly report

**Who:** organization administrators (`management.report.manage`); anyone with `management.dashboard.read` can open the produced reports.

1. Open **Management → Scheduled reports** (`/management/reports`), or **Scheduled reports** next to the CSV downloads on the dashboard.
2. Select **New schedule**. Give it a name, choose **Weekly** (Monday to Sunday) or **Monthly** (calendar month), a **Facility** or all the
   facilities you may report on, the **Tables** wanted and the **Recipients**.
3. Select **Schedule**. After the end of each week or month the tables are produced as CSV files and every recipient gets a message in the app
   and by email saying the report is ready — the message never contains figures.
4. Under **Produced reports**, select a table's name to download it. **Pause** stops a schedule without losing it; **Change** edits it.

**Things to know:**

- Reports are produced with the permissions of the person who set the schedule up (or last changed it). The system refuses a schedule for
  facilities you may not report on, revenue tables without billing report access, and recipients who may not view the dashboard for that scope.
- A revenue table opens only for a reader with billing report access for every facility of the report, even when it was produced.
- If a permission is taken away later, the affected table shows as **withheld** on that run (status **Partly withheld**); a report that could not
  be produced shows **Failed** with the reason and is tried again every hour for a week.
- Choosing recipients needs access to the staff list (`user.read`). Each download is recorded in the audit trail.

## Rules the system enforces

- A merge needs a reason, the versions you reviewed, every flagged difference acknowledged, and no work in progress under the record to retire. Both
  records must be in your organization; a record that is itself merged cannot survive. Merge and unmerge are audited.
- A merged record is read only: new care is refused there ("This record was merged into another patient; use the surviving record instead").
- Nothing from an import enters a record until a reviewer matches the patient and accepts the entry. Nothing is matched automatically.
- An import entry cannot be accepted before the patient is matched; the match cannot change after an entry was accepted for that patient.
- An imported allergy is always unconfirmed and never replaces an active allergy to the same substance.
- Refuted, entered-in-error, "no known allergy" and other patients' entries cannot be accepted. Unsupported types are never accepted.
- Rejecting an entry or a whole import needs a reason.
- Case reports open only for diagnoses matching your organization's active rules; each diagnosis gets at most one case report.
- Recording a case as reported needs DOH's reference; dismissing needs a reason. Decisions are allowed only while the case is To review, Rejected
  or Not sent.
- A check of earlier diagnoses covers at most 90 days, cannot end in the future, needs an active rule, and only one runs at a time.
- PhilHealth and DOH submissions are refused until an adapter for the official specification is configured.
- Resolving an unsuccessful exchange needs a note; only stalled exchanges can be re-queued.

## Troubleshooting / common messages

| Message                                                                                                                     | Meaning                                                   | What to do                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| The file was found to contain malware and cannot be accepted                                                                | The scanner quarantined the upload                        | Nothing to do with the file; the records office is told in the app. Ask for the document another way. |
| The file could not be checked for malware right now; try again later                                                        | The scanner is set up but unreachable                     | Try again in a few minutes; tell IT if it persists.                                                   |
| Finish, cancel or rebook the work in progress under this record first                                                       | Something is still in progress under the record to retire | Resolve each item under **Work in progress**, reload, then merge                                      |
| Review and acknowledge every flagged difference before merging                                                              | A difference was not ticked                               | Tick each difference after checking it                                                                |
| The record chosen to survive is itself merged                                                                               | You picked a retired record to keep                       | Choose the record it was merged into                                                                  |
| Match the patient first                                                                                                     | No patient matched yet                                    | Match or register the patient                                                                         |
| Entries were already accepted for the matched patient; the match cannot change                                              | The match is locked                                       | Reject remaining entries if the match was wrong, and correct accepted ones                            |
| This record was merged into another patient; match the surviving record                                                     | You chose a merged patient                                | Search again and match the surviving record                                                           |
| The imported Patient lacks a name, full birth date or sex: register through the registration form, then match               | Not enough demographics to register from the import       | Register through the normal registration form, then **Match**                                         |
| This entry cannot be accepted: …                                                                                            | The entry is refuted, in error, for another patient, etc. | Read the notes; reject it with a reason                                                               |
| This allergy is already recorded                                                                                            | The patient already has this active allergy               | Reject the entry as already recorded                                                                  |
| The received content is no longer available                                                                                 | Rejected content was deleted after 30 days                | Nothing to do; ask the sender to resend if needed                                                     |
| The import is sealed with key "…", which is not configured                                                                  | The encryption key for this import was removed            | Ask your platform administrator to restore the key                                                    |
| DOH reporting is not connected: … Report through DOH's own channel and record its reference here.                           | No DOH adapter                                            | Report through DOH's channel; **Record as reported** with its reference                               |
| The case report is reported / dismissed / …                                                                                 | The case was already decided                              | Reload the page                                                                                       |
| An active rule for … exists                                                                                                 | Duplicate rule                                            | Deactivate the old rule first if you want to change it                                                |
| No reportable conditions are active: add the rules first                                                                    | Check requested with no rules                             | Add a rule                                                                                            |
| A check of earlier diagnoses is already in progress                                                                         | One check at a time                                       | Wait for it to finish                                                                                 |
| A check covers at most 90 days; split the range / The range cannot end in the future / The start date is after the end date | Invalid range                                             | Adjust the dates                                                                                      |
| PhilHealth YAKAP is not connected: … Use PhilHealth's own channel for this consultation.                                    | No YAKAP adapter                                          | Use PhilHealth's own channel                                                                          |
| The prepared payload is gone; prepare the request again from its source                                                     | Cannot re-queue: the prepared content was deleted         | Submit again from the invoice, case report or patient record                                          |
| The exchange was already resolved                                                                                           | Someone else resolved it                                  | Reload the page                                                                                       |
| … was modified by someone else … Reload and try again.                                                                      | The record changed while you were working                 | Reload the page and repeat your action                                                                |

## Related chapters

- [Getting started](01-getting-started.md) — navigation and permissions
- [Patients](02-patients.md) — external history, allergies, PhilHealth eligibility and YAKAP registration answers
- [Consultations and care plans](04-consultations-and-care-plans.md) — recording diagnoses (ICD-10) that trigger case reports
- [Billing](10-billing.md) — PhilHealth claims, accreditation and YAKAP participation settings
- [Administration](13-administration.md) — roles, permissions and audit trail
- [Glossary and FAQ](14-glossary-and-faq.md)
