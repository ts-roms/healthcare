# 5. Telemedicine

## What this is for

Online consultations let a patient see a physician by video from home. It is a full clinical workflow, not just a video call: the patient answers
pre-consult questions, waits in a virtual waiting room, and the physician documents, diagnoses, prescribes, orders tests and books follow-ups in
the same encounter workspace used for in-person visits. When a patient needs to be examined, the physician escalates to in-person care.

```
Patient: booked online visit → pre-consult questions → waiting room → video
Physician: online consultations list → review answers → start → video → note, diagnosis, prescription, lab order, follow-up
           → end with instructions, or escalate to in-person care → sign the encounter
```

Not every condition is suitable for an online consultation. The platform never decides that a patient is safe to be seen online — the physician
does.

## Who uses it

- **Physicians** (`telemedicine.read` and `telemedicine.conduct`, plus `encounter.write`) review answers, start, join, end and escalate
  consultations.
- **Nurses and receptionists** (`telemedicine.read`) see the list of today's online consultations and who is waiting, and can read the
  pre-consult answers.
- Organization administrators have every permission.

| Screen                             | Menu                               | Needs                                           |
| ---------------------------------- | ---------------------------------- | ----------------------------------------------- |
| Online consultations (today)       | **Telemedicine** (`/telemedicine`) | `telemedicine.read`                             |
| One consultation, before it starts | `/telemedicine/[appointmentId]`    | `telemedicine.read`                             |
| During and after the consultation  | The encounter workspace            | `encounter.read`; `telemedicine.conduct` to act |

## How online consultations are booked

An online consultation is an ordinary appointment whose visit type is **Online (video)**.

- **Staff** book it like any appointment from the patient record (**Book appointment**); online visit types are marked "online" in the list. See
  [Appointments and queue](03-appointments-and-queue.md).
- **Patients** book it themselves in MyHealth if the clinic has opened that visit type for online booking (**Appointments → Online booking**).

Online consultations appear on the day schedule with an online icon. You do not need to check these patients in at the front desk — the patient
checks in by entering the waiting room.

## What the patient does

Explain this to patients who call for help (see also [MyHealth patient portal](12-patient-portal.md)):

1. In MyHealth, the patient opens the consultation and answers **Before your consultation**: the reason (required), symptoms and for how many
   days, medicines they take now, any new allergies, a checklist of warning signs ("Do you have any of these right now?"), where they will be
   during the call (city or municipality), and a callback number in case video fails. They also acknowledge how online consultations work.
2. If they tick a warning sign, MyHealth tells them at once: "This may be an emergency. Do not wait for an online consultation." and urges them
   to call 911 or go to an emergency room.
3. From 30 minutes before the start time until the appointment ends, they can enter the waiting room. This checks them in automatically; they
   appear in the facility queue as **Ready for provider** (online visits skip triage).
4. When the physician starts, the patient joins the video. If video is not configured, MyHealth tells them "Your doctor will call you".
5. Afterwards the patient sees the physician's instructions, or that the doctor recommends seeing them in person.

## How to see today's online consultations

1. Open **Telemedicine** (`/telemedicine`). The list shows today's online consultations at the selected facility. Patients in the waiting room
   come first (longest wait first), then consultations in progress, then by start time.
2. Each row shows the time, patient name, number and age, the practitioner, and **Progress**:
   - **Not answered yet** — the patient has not answered the pre-consult questions.
   - **Questions answered** — answered, not yet in the waiting room.
   - **In the waiting room** (with "since" time) — ready to be seen.
   - **In consultation**, **Ended**, **Escalated to in-person**.
3. A **red flags** badge shows how many warning signs the patient reported.
4. The row's button reads **Review and start** (patient waiting), **Review answers** (not yet waiting) or **Open consultation** (already
   started).

If you have queue access, a **Live** indicator shows that the list updates by itself. If the header says "video is not configured: call patients on
their callback number", your organization has not set up a video provider; everything else works.

If the list is empty: "No online consultations today. Book them as appointments with an online visit type."

## How to review the pre-consult answers

1. Select **Review answers** or **Review and start**.
2. Under **Pre-consult answers** you see, in the patient's own words: **Reason**, **Symptoms** (with duration), **Current medicines**, **New
   allergies**, **Location** and **Callback number** (select it to call).
3. If the patient reported red flags, a red box leads: "Red flags reported — consider in-person or emergency care", with the list. The patient
   was already told to call 911 or go to an emergency room.
4. **New allergies** are marked "record them before prescribing". Record them on the patient record or in the workspace's **Allergies** panel
   (see [Patients](02-patients.md)).

The answers are the patient's report, not a triage decision.

## How to start the consultation

1. On the consultation page, the **Consultation** card shows the time, practitioner and progress. While the patient has not entered the waiting
   room it says "Start becomes available when the patient enters the waiting room." The page checks every 10 seconds.
2. When the patient is **In the waiting room**, select **Start consultation**.
3. The encounter workspace opens, marked **Online**, with an **Online consultation** panel above the note.

**Start consultation** needs `telemedicine.conduct` and `encounter.write`, and your account must be linked to a practitioner.

Online consultations are started only from **Telemedicine**. On the **Queue** board and the **Consultations** list, an online visit shows **Open
in Telemedicine** instead of **Start consultation**; it takes you to the consultation's page. An ordinary consultation cannot be started for an
online visit ("This is an online consultation. Start it from Telemedicine, so the patient waiting in MyHealth joins the call").

## How to run the video call

In the **Online consultation** panel:

1. Select **Join video**. The call opens in the panel. Select **Leave call** to leave; you can join again while the consultation runs.
2. If video fails or is not configured ("Video is not configured. Call the patient on the callback number and document as usual."), select
   **Callback …** at the top of the panel to call the patient's number.
3. Expand **Pre-consult answers** at any time (it opens by itself when there are red flags).
4. Document in the workspace as for any consultation: note, diagnoses, prescriptions, laboratory orders, care plans and follow-up. See
   [Consultations and care plans](04-consultations-and-care-plans.md).

Video tokens are issued only while the consultation is running, and calls are not recorded.

## How to end the consultation

1. Select **End consultation…**.
2. Write **Instructions for the patient (shown in MyHealth)** — for example how to take the medicines and when to come back.
3. Select **End consultation**. The message reads "Consultation ended — sign the encounter when done".
4. Finish the note and select **Sign encounter** in the workspace.

Ending closes the call only; the encounter stays open until you sign it. You can still change the instructions afterwards: edit them under
**Instructions for the patient (shown in MyHealth)** and select **Save instructions**.

## How to escalate to in-person care

When the patient needs to be examined in person (or sent to emergency care):

1. Select **Escalate to in-person care…**.
2. Enter **Why does the patient need in-person care? \*** (at least 5 characters). This is recorded for the care team; the patient sees only that
   in-person care is recommended, and your instructions.
3. Write **Instructions for the patient (shown in MyHealth)**.
4. Select **Escalate**. The online consultation ends and shows **Escalated to in-person**, with your reason.
5. Select **Book the in-person visit** to book the patient with you (needs `appointment.manage`). You return to the encounter after booking.
6. Sign the encounter when your documentation is complete.

## Rules the system enforces

- The patient must answer the pre-consult questions before entering the waiting room.
- The waiting room opens 30 minutes before the start time and closes when the appointment ends.
- A consultation can be started only when the patient is in the waiting room, and only once.
- Video is available only while the consultation is running.
- Escalating needs a reason. Instructions can be written only once the consultation has started.
- Everything clinical — signing, amendments, prescriptions and orders — follows the same rules as an in-person encounter.

## Troubleshooting / common messages

| Message                                                                 | Meaning                                           | What to do                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| The patient is not in the waiting room yet                              | The patient has not entered                       | Wait (the page refreshes), or call the callback number      |
| The consultation was started by someone else                            | A colleague started it first                      | Open it from **Telemedicine** (**Open consultation**)       |
| The consultation has ended (or escalated)                               | It is closed                                      | Document and sign the encounter; book a new visit if needed |
| Video is available only during the consultation                         | The consultation has not started or has ended     | Start the consultation first                                |
| Video is not configured                                                 | No video provider is set up for your organization | Use the callback number                                     |
| Instructions are written during or after the consultation               | The consultation has not started                  | Start it first                                              |
| Your account is not linked to a practitioner who can conduct encounters | No practitioner record for your user              | Ask your administrator                                      |
| The waiting room opens 30 minutes before the consultation (patient)     | The patient tried too early or after the end      | Tell the patient when to come back, or rebook               |
| Please answer the questions before the consultation first (patient)     | The questionnaire is missing                      | Ask the patient to answer it in MyHealth                    |

Requirements for telemedicine in your facility (DOH, PRC, NPC — consent wording, identity checks, record retention) must be confirmed against
current official guidance before production use. The platform does not claim compliance.

## Related chapters

- [Appointments and queue](03-appointments-and-queue.md) — booking and online-booking settings
- [Consultations and care plans](04-consultations-and-care-plans.md) — the encounter workspace
- [Patients](02-patients.md) — allergies and telemedicine consent
- [MyHealth patient portal](12-patient-portal.md) — the patient's side
- [Administration](13-administration.md) — permissions
