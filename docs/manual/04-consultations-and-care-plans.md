# 4. Consultations and care plans

## What this is for

The encounter workspace is where the physician (or dentist) sees the patient: a SOAP note, diagnoses, prescriptions with drug–allergy decision
support, laboratory orders, follow-up booking and care plans — all on one screen, next to the patient's allergies, problems, active medicines,
recent laboratory results and vital signs. Once signed, the encounter is part of the patient's permanent record and changes only by amendment.

Care plans are longer-term plans for a patient (for example a diabetes plan): problems, goals and planned activities such as follow-up visits and
repeat laboratory tests. The **recall list** shows which of these activities are due or overdue across the organization.

## Who uses it

- **Physicians and dentists** start, document and sign consultations, prescribe, order tests and create care plans.
- **Nurses** can read encounters, manage care plans and work the recall list (by default they cannot write notes, prescribe or book).
- **Receptionists** book follow-ups that the care plan asks for (from the recall list, if they have care-plan access).
- **Records officers** can read encounters, prescriptions and care plans.

| Screen                | Menu                                           | Needs            |
| --------------------- | ---------------------------------------------- | ---------------- |
| Consultations (today) | **Clinic → Encounters** (`/clinic/encounters`) | `encounter.read` |
| Encounter workspace   | `/clinic/encounters/[id]`                      | `encounter.read` |
| Recall list           | **Clinic → Care Plans** (`/clinic/care-plans`) | `care-plan.read` |
| Care plan             | `/clinic/care-plans/[id]`                      | `care-plan.read` |

Other permissions used in this chapter: `encounter.write` (start, write notes, add diagnoses), `encounter.sign`, `encounter.amend`,
`prescription.read | issue | cancel`, `lab.order.read | create | cancel`, `lab.result.read`, `care-plan.manage`, `appointment.manage` (book
follow-ups), `clinical.read` (clinical summary) and `allergy.manage`. Physicians and dentists have all of these by default; organization
administrators have every permission.

Prescriptions are written inside the encounter. **Clinic → Prescriptions** lists the prescriptions issued at your facility (see "How to find
prescriptions issued at your facility") and **Clinic → Referrals** lists referrals (see "How to refer a patient").

## How to start a consultation

You must be linked to a practitioner record to start a consultation or prescribe. If you see "Your account is not linked to a practitioner who can
conduct encounters", ask your administrator.

1. Open **Clinic → Encounters**. The **Consultations** list shows today's patients at the selected facility who are ready for the provider, with
   the provider, or already seen — with ticket, arrival time, complaint, priority and status.
2. Select **Start consultation** next to the patient. (You can also start from the ticket panel on the **Queue** board.) For an online visit the
   button is **Open in Telemedicine**; see [Telemedicine](05-telemedicine.md).
3. The encounter workspace opens. The patient moves to **With provider** on the queue, and you become the responsible practitioner for this
   encounter.

If a patient already has a consultation, select **Open** instead. Online consultations are started from **Telemedicine**; see
[Telemedicine](05-telemedicine.md).

## The encounter workspace at a glance

- **Top banner** — the patient, allergies, the encounter status (**In progress**, **Signed** or **Entered in error**), start time, practitioner,
  **Online** for a teleconsultation, and **Patient 360** (the patient's one-screen workspace — see [Patients](02-patients.md)).
- **Encounters** (left) — the patient's previous encounters by date and status. Select one to open it.
- **Current encounter** (centre) — chief complaint, the SOAP note, **Diagnoses**, **Prescriptions**, **Laboratory**, **Care plans**, and
  **This visit** (the triage and vital signs recorded for this visit).
- **Clinical context** (right) — **Allergies** (you can record and review allergies here), **Problems**, **Active prescriptions**, **Recent
  laboratory results** (released results only), and **Latest vitals**. Without `clinical.read` you see "The clinical summary needs clinical
  access."
- **Bottom bar** — **Follow-up in** shortcuts, save state, **Save draft**, **Sign encounter**, **Amend note**, **Opened in error…**.

## How to write the note

1. Type in the four sections: **Subjective**, **Objective**, **Assessment** and **Plan**. Leave a section blank if it does not apply.
2. Select **Save draft**, or press **Ctrl S** (Cmd S on a Mac). Each save is a new revision; the bar shows "Saved · revision N" or "Unsaved
   changes".
3. The browser warns you if you try to close the page with unsaved text. Following a booking link from the workspace saves the draft first.

If a colleague saved the same note after you opened it, your save is refused and a yellow box appears: "The note was changed elsewhere". Your text
is kept. Compare it with the latest saved version and choose **Discard my changes, use the latest** or **Keep my text (saves as a newer
revision)**. Nothing is overwritten silently.

Select **N revisions** at the top of the note to open **Note history**: every draft, the signed version and amendments, with times and reasons.

## How to record diagnoses

1. Under **Diagnoses**, select **Add diagnosis**.
2. Enter the **Diagnosis \*** in words.
3. If your organization has configured a code system, choose the **Code system** and enter the **Code** (for example an ICD-10 code). Codes are
   stored as you type them; the platform does not check them against a code list. If no code system is configured, the diagnosis is recorded as
   text.
4. Choose the **Rank** — **Primary** (only one per encounter) or **Secondary** — and the **Certainty** — **Provisional** or **Confirmed**.
5. Tick **Chronic condition** if it applies. Active chronic diagnoses stay in the patient's **Problems** list; other active diagnoses appear there
   for 90 days after they were recorded.
6. Select **Add diagnosis**.

To change an existing diagnosis, select **Resolve…** or **Entered in error…**, give the reason, and select **Confirm**. Diagnoses are never
deleted; entered-in-error ones stay visible, struck through.

After signing, adding or correcting a diagnosis is an amendment: you need `encounter.amend` and must enter an **Amendment reason \***.

## How to prescribe

Prescriptions are issued inside an open (in-progress) encounter and need `prescription.issue`.

1. Under **Prescriptions**, select **New prescription** (or press **Alt P**).
2. Check the **Allergies** line at the top of the dialog. It shows the recorded allergies, "no known allergies (reviewed)", or "not recorded — ask
   the patient before prescribing".
3. For each medicine fill in **Generic name \***, **Brand**, **Strength**, **Form**, **Dose**, **Dose unit**, **Route \***, **Frequency \***
   (with **Describe frequency \*** for **Other (describe)**, or **As needed for \*** for **As needed**), **Duration** and **Unit**, **Quantity \***,
   **Qty unit \***, **Refills** and **Instructions for the patient \***.
4. Select **Add medicine** for more lines (up to 20).
5. Optionally add **Notes (for the pharmacist)**.
6. Select **Issue prescription**. A prescription number is assigned.

### Drug–allergy decision support

When you submit, each medicine name is compared with the patient's recorded allergies. If a name matches, the prescription is **not** issued yet
and a red box appears: **Decision support: possible drug–allergy conflict**, listing the medicine, the matching allergy, the reaction and
criticality.

- To change course, edit or remove the medicine and submit again.
- To prescribe anyway, enter a **Reason for overriding \*** (at least 10 characters) and select **Override and issue**. The override and reason
  are recorded in the audit trail and shown on the prescription (**Allergy warning overridden**).

This check compares names only. It does not know drug classes or cross-reactivity, so **no warning does not mean a medicine is safe**. The
decision stays with you.

### Correct or cancel a prescription

Issued prescriptions cannot be edited.

- **Replace…** — opens the prescription pre-filled. Make the correction, enter a **Reason for replacing \*** (at least 5 characters, e.g. "Dose
  corrected") and select **Replace prescription**. The old one becomes **Superseded** and points to the new one. Replacing is possible also after
  the encounter is signed (needs `prescription.issue`).
- **Cancel…** — enter **Why cancel? \*** (at least 5 characters) and select **Cancel prescription** (needs `prescription.cancel`).

Only **Active** prescriptions can be replaced or cancelled. Dispensing is covered in [Pharmacy and inventory](09-pharmacy-and-inventory.md).

## How to find prescriptions issued at your facility

**Clinic → Prescriptions** lists the prescriptions issued at the facility selected in the top bar, newest first.

1. Choose **Everyone at this facility** or **Issued by me** (only for accounts linked to a practitioner).
2. Set **From (day)** and **To (day)** (today by default; at most 92 days) and, if you like, a **Status**: **Active**, **Replaced** or
   **Cancelled**. Select **Show**. **Today** returns to today's list.
3. Each row shows the prescription number and time, the patient, what was prescribed (name, strength, form and quantity), the prescriber and
   the status (with the reason for a cancellation). Select the number to open the consultation it was issued in, or the patient's name to open
   their record.

The line above the table counts the period's prescriptions by status. At most 300 are listed; choose a shorter period to see the rest. Dose
instructions are not shown in the list: open the prescription. Opening the list is recorded in the audit trail for each patient listed.

## How to order laboratory tests

You need `lab.order.create`, and the encounter must be in progress.

1. Under **Laboratory**, select **Order tests**.
2. Type in **Filter tests and panels** to narrow the list, and tick panels and single tests. Tests inside a ticked panel are ticked for you.
3. Choose the **Priority** — **Routine** or **STAT**.
4. Check the **Clinical indication**. It is pre-filled from the encounter's active diagnoses.
5. Optionally add notes to the laboratory.
6. If a test needs fasting, you see "Includes tests that need fasting — tell the patient."
7. Select **Order N tests**. The order number appears and the order goes to the laboratory.

Each order card shows its tests and their progress (**To collect**, **Collected**, **In the lab**, **In progress**, **Released**, **Cancelled**).
Results appear only once the laboratory releases them, with the value, unit, flag, reference range, a **Critical** badge where applicable, and a
note when a result was corrected. Select **Report** to open the printable report.

To cancel, select **Cancel order…**, enter a reason and select **Cancel order** (needs `lab.order.cancel`; only while no test has a result). See
[Laboratory](06-laboratory.md) for what happens in the laboratory.

## How to book a follow-up

You need `appointment.manage`.

1. In the bottom bar, next to **Follow-up in**, select **1 week**, **2 weeks**, **1 month** or **3 months**. Your draft note is saved first.
2. The booking page opens with the patient, you as practitioner, the day and the reason "Follow-up" filled in. Choose the visit type and a slot,
   and select **Book** (see [Appointments and queue](03-appointments-and-queue.md)).
3. You return to the encounter.

## How to sign the encounter

1. Make sure the **Assessment** or the **Plan** is filled in. The platform will not sign a note with neither.
2. Select **Sign encounter**. Unsaved changes are saved first, so what you sign is what you see.
3. The status becomes **Signed**. The patient's visit is completed (the ticket moves to **Done**) and the appointment, if any, is completed.

Only the responsible practitioner — the one who started the consultation — can sign, and needs `encounter.sign`. If the organization has linked
a billing service to the visit type, signing also creates the consultation charge (see [Billing](10-billing.md)).

## How to issue a medical certificate

Certificates are issued once the consultation is signed — in person or online — by its responsible practitioner (`encounter.sign`).

1. On the signed encounter, find **Medical certificates** and select **Issue a certificate**.
2. Write the **Purpose** (for example "Absence from work"), check the **Findings / diagnosis** — filled in from the consultation's diagnoses; edit
   it to what should be printed — and add **Recommendations** if any.
3. For a rest period, choose **Rest from** and **to** (both days included).
4. Select **Issue certificate**. It gets a number (`MC########`); select **Print** for the printed copy with your name and license number. The
   patient can also download it in MyHealth (**Documents**) and gets a message that it is ready — without the findings.

An issued certificate cannot be edited. If it is wrong, select **Void…**, give the reason and issue a new one. The issuing practitioner, or staff
who may amend consultations, can void. A voided certificate leaves MyHealth; its printed copy shows **VOID**. The platform adds no wording that
an employer, school or agency may require — write what they need in your own words.

## How to record a vaccine given in the consultation

The encounter workspace has an **Immunizations** section: doses recorded in this consultation, **Record dose given here** (linked to this
consultation; from stock or with the lot number typed; or **Not given** with the reason) and the earlier history, with a link to the full
history. It works the same as on the patient record (see [Patients](02-patients.md)). Nothing in it says which dose is due.

## How to record a procedure done in the consultation

The encounter workspace has a **Procedures** section for what you did to the patient in this visit — dressing, suturing, incision and drainage,
nebulization, an injection and the like (dental work and vaccines have their own sections). Your clinic lists the procedures it performs under
**Clinic → Procedures**; an administrator adds them.

1. Select **Record procedure**.
2. Choose the **Procedure**, who **Performed by** (you, or another practitioner such as the nurse who did it), **When** (leave empty for now),
   the **Body site** (asked for some procedures, for example "left forearm"), **How many** (billed as this quantity) and any **Notes**.
3. Select **Record procedure**. If your clinic has priced it, the charge appears at the cashier.

Procedures are not recorded in online consultations. After the consultation is signed, only staff who may amend consultations can add one, and
they must say **why it is recorded after signing**; it is marked **Recorded after signing**. A mistake: **Entered in error…** with a reason (the
person who recorded it, or someone who may amend consultations). It stays listed, struck through, and a charge not yet on an invoice is cancelled.

**Supplies used.** Under each procedure, **Supplies used** takes what you used from the facility's stock:

1. Under **Confirm the supplies used**, check the list. It starts from the supplies your clinic listed for that procedure; change quantities,
   **Add supply** or remove a line.
2. Choose where they were **Taken from** (a stock location of your facility). Each line shows how much is usable there.
3. For a controlled item, enter a **Reason** and a **Reference** (for example the register entry).
4. Select **Issue from stock**.

The oldest-expiring lots are used first and expired lots never. If anything is short, nothing is issued and the line is marked. The lots issued are
listed for traceability. To record more later, use the form again. To give back what was not used, select **Return unused supplies…**, enter how
many of each lot come back and a reason, then **Return to stock** — this also works after a procedure was entered in error, which never returns
supplies by itself.

An administrator lists the supplies each procedure usually uses under **Clinic → Procedures**, **Supplies per procedure** (**Edit**, **Add supply**,
**Save**). This is only a starting list. Only medical supplies, medicines, PPE and other items can be used; dental supplies, reagents and vaccines
cannot.

## How to review and record the history in the consultation

The encounter workspace has a **Medical, medication, family and social history** section: past procedures and conditions, medicines taken that
were not prescribed here (with **Mark stopped…**), the family history with its state,
and the current social history, with the same buttons as on the patient record (see [Patients](02-patients.md)). What you record there is linked
to this consultation. Entries in error and earlier social history versions are on the full history page (**Full history**). Private parts
(substance use, sexual history) are shown only to clinicians who write consultation notes.

## How to refer a patient

The consultation's responsible practitioner refers from the encounter workspace, during the consultation or after signing.

1. Under **Referrals**, select **Refer**.
2. Choose **A practitioner here** and pick the practitioner, or **An outside provider** and write the provider's name, and optionally the facility
   and how to reach them.
3. Add the **Specialty or service** if useful, choose the **Urgency**, write the **Reason for referral** (your question for them) and, if you like,
   a **Clinical summary**. Tick the diagnoses to list on the letter.
4. Select **Send referral**. It gets a number (`RF########`). Select **Letter** to print it; it lists the patient's active allergies and your name
   and license number.

What you write cannot be edited. If it is wrong, open the referral and cancel it with a reason, then refer again.

**When a patient is referred to you**, you get a message under the bell. Open **Clinic → Referrals** (`/clinic/referrals`, **Referred to me**),
open the referral and select **Accept** or **Decline** (declining needs a reason the referrer reads). Reception can link the appointment they
book with you (**Appointment → Link appointment**, or **Book an appointment…**). After you have seen the patient, write **What came of it** and
select **Complete referral**; the referrer is told.

**For an outside provider**, give or send the letter the way you usually do. When their reply arrives, open the referral and use **Record the
reply**: write a summary and, if you uploaded the reply to the patient record, its document id. The platform sends nothing to outside
providers by itself.

Referrals appear on the patient's timeline (without the reason), in a **Referrals** card on the patient record and in the **Referrals** panel of
Patient 360. **Clinic → Referrals** also lists referrals you made, all open ones and **Overdue** ones. When the patient uses MyHealth, they see the
referral (to whom, when, where it stands) and can open the letter; they get a message that a referral letter is ready, without who it is to or why.

**Overdue referrals.** Your organization can choose after how many days a referral still awaiting an answer (from a practitioner here) or a reply
(from an outside provider) is marked **Overdue** (with a clock icon and the word). It is off until someone sets it: staff who may configure the
clinic open **Clinic → Referrals → Follow-up setting**, tick **Flag referrals still awaiting an answer or reply**, enter the number of days (1–365)
and select **Save**; untick it to turn the flag off. The platform assumes no deadline and sends nothing by itself — follow the referral up the way
your organization does.

## How to amend a signed encounter

1. Open the signed encounter and select **Amend note** (needs `encounter.amend`).
2. Edit the note.
3. Enter the **Reason for amendment \*** (at least 3 characters) and select **Save amendment**.

The signed version stays in **Note history**. The workspace shows "Amended … : reason" above the note.

## How to mark an encounter opened in error

Use this for a wrong patient or a duplicate, while the encounter is still in progress.

1. Select **Opened in error…**.
2. Enter the **Reason \*** (for example "Opened for the wrong patient").
3. Select **Mark entered in error**.

The encounter is kept for audit, marked **Entered in error**, and is not part of the patient's care. The patient returns to the queue as **Ready
for provider**, so the correct encounter can be started.

## How to create a care plan

Care plans are created from an encounter (needs `care-plan.manage`).

1. Under **Care plans** in the encounter, select **New care plan**.
2. Enter the **Title \*** (e.g. "Type 2 diabetes care plan"), **Category** (**Chronic disease**, **Preventive**, **Post-procedure**,
   **Maternal**, **Other**), **Start** date and an optional **Description**.
3. Under **Problems**, the encounter's active diagnoses are ticked. Untick any that do not belong. (Add a diagnosis first if none is listed.)
4. Under **Goals**, describe each goal with an optional measure (e.g. "HbA1c"), target (e.g. "< 7%") and target date. **Add goal** adds more.
5. Under **Activities**, choose the kind — **Follow-up visit**, **Lab monitoring**, **Medication**, **Lifestyle**, **Education**, **Referral**,
   **Patient task**, **Care-team task** — describe it, choose **Care team** or **Patient**, link a goal, set **Due** (or use **+14 d**, **+30 d**,
   **+90 d**), and optionally **Repeat every** N days (1–730). **Add activity** adds more.
6. Select **Create care plan**. You need at least a title and one goal or activity.

The plan is created as **Active**. Goals are what you set; the platform tracks them but does not interpret results against them.

## How to work with a care plan

Open a plan with **Open plan** (from the encounter) or from the recall list.

- **Status** — **Put on hold…**, **Resume**, **Mark completed**, **Cancel plan…**. Putting on hold and cancelling need a reason. Completed and
  cancelled plans can no longer be changed.
- **Goals** — change each goal's status: **Proposed**, **Active**, **Achieved**, **Not achieved**, **Cancelled**.
- **Activities** — for each open activity:
  - **Book** (for a planned **Follow-up visit**; needs `appointment.manage`) — opens the booking page with the due date and description filled
    in. After booking, the appointment is linked and the activity becomes **Scheduled**.
  - **Done** — marks it done. For a repeating activity, the next one is created, due the set number of days from today.
  - **Cancel…** — needs a reason.
  - **Add activity** adds a new one. Completed and cancelled activities are listed under **Completed and cancelled**.
  - Open activities past their due date show **Overdue**.
- **Progress notes** — type a **New note** and select **Add note**. Notes cannot be edited or removed.

## How to use the recall list

1. Open **Clinic → Care Plans** (`/clinic/care-plans`). The **Recall list** shows planned and in-progress activities of active care plans across
   the organization that are overdue or due soon.
2. Choose the horizon — **7 days**, **30 days** or **90 days** — and optionally one activity kind (or **All**).
3. Each row shows the due date (**Overdue** if past), the patient, the activity (with "patient reminded …" if an automatic reminder was sent), and
   the care plan.
4. Use **Book**, **Done** or **Cancel…** as on the plan. After booking you return to the recall list.

Contact patients according to their communication preferences and consent.

### Automatic recall reminders

The platform itself reminds patients of **Follow-up visit** and **Lab monitoring** activities of active plans that nobody has booked yet: once from
7 days before the due date, and once more when 7 days overdue. After 30 days overdue it stops, and the care team follows up from the recall list.
Messages go by SMS and to the MyHealth inbox between 08:00 and 20:00 Manila time, at most one per patient per day, and name no condition, test or
plan. The patient's communication preferences apply.

## Rules the system enforces

- Only a practitioner linked to your account can start an encounter or prescribe; only the responsible practitioner can sign.
- A note needs an assessment or a plan before signing.
- Signed notes change only by amendment with a reason; every revision is kept.
- One primary diagnosis per encounter. Diagnoses and encounters are marked resolved or entered in error, never deleted.
- New prescriptions and laboratory orders only while the encounter is in progress. Issued prescriptions are corrected only by replace or cancel.
- A drug–allergy name match stops the prescription until you change it or give an override reason (10+ characters).
- Care plans, goals and activities of a completed or cancelled plan cannot be changed. Holding or cancelling a plan, and cancelling an activity,
  need a reason.

## Troubleshooting / common messages

| Message                                                                                  | Meaning                                  | What to do                                                     |
| ---------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| Your account is not linked to a practitioner who can conduct encounters                  | Your user has no practitioner record     | Ask your administrator to link you                             |
| This visit already has an encounter                                                      | Someone already started it               | Open the existing consultation                                 |
| Document at least an assessment or plan before signing                                   | Both sections are empty                  | Fill in the Assessment or Plan                                 |
| Only the responsible practitioner can sign this encounter                                | Another practitioner started it          | Ask that practitioner to sign                                  |
| The encounter changed; reload before signing                                             | Someone changed it while you had it open | The page reloads; check and sign again                         |
| The note was changed by someone else; reload to see the latest revision                  | Another save happened first              | Use the yellow box to choose which text to keep                |
| The encounter is signed; add an amendment instead                                        | You tried to save a draft after signing  | Use **Amend note**                                             |
| The encounter already has a primary diagnosis                                            | A second primary was chosen              | Choose **Secondary**                                           |
| Coding system "…" is not configured                                                      | The code system is not set up            | Record the diagnosis without a code; ask your administrator    |
| Prescriptions are issued during an open encounter; replace an existing one to correct it | The encounter is signed                  | Use **Replace…** on the prescription, or start a new encounter |
| Your account is not linked to a practitioner who may prescribe                           | No practitioner record                   | Ask your administrator                                         |
| The prescription is superseded (or cancelled)                                            | It is no longer active                   | Work on the current prescription                               |
| Laboratory tests are ordered during an open encounter                                    | The encounter is signed                  | Order in an open encounter                                     |
| Some tests already have results; cancel the remaining tests one by one                   | The order has started in the laboratory  | Ask the laboratory to cancel individual tests                  |
| Cannot change a completed care plan to …                                                 | Closed plans are final                   | Create a new plan if needed                                    |
| The care plan is completed (or cancelled)                                                | You tried to change a closed plan        | Create a new plan if needed                                    |

## Related chapters

- [Appointments and queue](03-appointments-and-queue.md) — booking, check-in, triage
- [Patients](02-patients.md) — allergies, patient record and timeline
- [Telemedicine](05-telemedicine.md) — online consultations use this same workspace
- [Laboratory](06-laboratory.md) — what happens to your orders
- [Pharmacy and inventory](09-pharmacy-and-inventory.md) — dispensing prescriptions
- [Billing](10-billing.md) — consultation charges
- [Dental](08-dental.md) — dental visits are encounters with a dentist
