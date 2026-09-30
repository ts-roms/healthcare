# 3. Appointments and queue

## What this is for

This chapter covers a patient's arrival at the clinic: booking an appointment, confirming it, checking the patient in (with an appointment or as a
walk-in), running the facility's queue, and recording triage and vital signs before the consultation. Everything here happens at the facility you
selected in the top bar. Times are shown in that facility's time zone (Asia/Manila unless your organization set another).

## Who uses it

- **Receptionists** book, confirm, cancel and check patients in, and call patients from the queue.
- **Nurses** run the queue and record triage and vital signs.
- **Physicians and dentists** see the queue and start consultations from it (see [Consultations and care plans](04-consultations-and-care-plans.md)).
- **Clinic administrators** choose which visit types patients may book online.

| Screen           | Where                                            | Needs                                                    |
| ---------------- | ------------------------------------------------ | -------------------------------------------------------- |
| Day schedule     | **Appointments** (`/appointments`)               | `appointment.read`                                       |
| Book appointment | `/appointments/new` (from the record)            | `appointment.manage`                                     |
| Visit types      | **Online booking** (`/appointments/visit-types`) | `appointment.read` to view, `clinic.configure` to change |
| Queue board      | **Queue** (`/queue`)                             | `clinic.queue.read`; `clinic.queue.manage` to act        |
| Check in walk-in | `/queue/walk-in` (from the record)               | `clinic.queue.manage`                                    |
| Triage           | `/queue/visits/[id]/triage`                      | `clinic.triage.write`                                    |

By default, receptionists have `appointment.read`, `appointment.manage`, `clinic.queue.read` and `clinic.queue.manage`. Nurses have
`appointment.read`, the queue permissions and `clinic.triage.write`, but not `appointment.manage`. Physicians (and dentists) have all of these.
Organization administrators have every permission. Your organization may have changed these defaults.

If a screen says you must choose a facility first, pick one in the top bar — schedules and queues are kept per facility.

## How to view the day's appointments

1. Open **Appointments** (`/appointments`). You see today's schedule for the selected facility, one card per practitioner.
2. Use the arrows (**Previous day**, **Next day**) or **Today** to change the day.
3. To see one practitioner only, choose them under **Practitioner** (the default is **All practitioners**).
4. Each row shows the time, patient name and patient number, practitioner, visit type and reason, whether it is in person or online, and a
   status: **Booked**, **Confirmed**, **Arrived** (checked in), **Completed**, **No-show** or **Cancelled**.
5. Appointments the patient booked themselves in MyHealth show **Booked online by the patient**.
6. Select **Record** to open the patient record (needs `patient.read`).

The screen shows at most 100 appointments. If you see "Showing the first 100 appointments. Filter by practitioner to see the rest.", choose a
practitioner.

## How to book an appointment

Appointments are booked from the patient record, so you always book for the right person.

1. Select **Find patient to book** on the Appointments screen (or search under **Patients**), and open the patient record.
2. Select **Book appointment**. (It appears only for active records and only if you have `appointment.manage`.)
3. Choose the **Practitioner \***, the **Visit type \*** and the **Day \***. Online visit types are marked "online" in the list.
4. Under **Open slots**, pick a time. Only open times in the practitioner's published schedule at this facility are offered — times already
   booked, and leave or facility closures, are left out. If you see "No open slots on this day. Try another day or practitioner.", change the
   day or practitioner.
5. Under **Booked via**, choose **Front desk** or **Phone**.
6. Optionally enter a **Reason for visit** (for example "Follow-up of blood pressure").
7. Select **Book** (the button shows the chosen time, for example **Book 09:30**).

If the time was taken by someone else while you were choosing, the booking is refused and the open slots reload. Choose another time.

If the patient record is not active (for example deceased or merged), a warning appears: "This record is … Check the patient record before
booking."

Booking from a consultation or a care plan works the same way; see [Consultations and care plans](04-consultations-and-care-plans.md). In that
case, after booking you return to where you started.

> Not available in the staff app yet: rescheduling an appointment and recurring appointments. To move an appointment, cancel it (with a reason) and
> book a new one. The waiting list is under **Waiting list** (see below).

## How to confirm, cancel or mark a no-show

On the day schedule, each open appointment (**Booked** or **Confirmed**) shows the actions you may take:

- **Confirm** — for a **Booked** appointment, when the patient has confirmed they will come.
- **Cancel** — opens a box. Enter a **Reason for cancelling \*** (at least 3 characters, for example "Patient called to cancel"), then select
  **Cancel appointment**. Select **Keep** to leave it booked.
- **No-show** — appears only once the appointment's start time has passed. Marking a no-show may send the patient a "we missed you" message
  inviting them to book again (not if they already have another visit booked), subject to their communication preferences.

These actions need `appointment.manage`.

Patients receive an SMS reminder about 24 hours before a booked appointment (if their consent and preferences allow). Cancelling or marking a
no-show withdraws a reminder that has not yet been sent.

## How to check in a patient with an appointment

1. On the day schedule (on the appointment's own day), select **Check in** on the patient's row.
2. A message confirms the check-in and gives the queue ticket, for example "Checked in … — ticket A-001".
3. The patient now appears on the **Queue** board under **Waiting**, and the appointment shows **Arrived**.

**Check in** appears only for today's in-person appointments and needs `clinic.queue.manage`. Online appointments have no **Check in**: the
patient checks in by entering the MyHealth waiting room. Patients checked in from an appointment start with routine
priority; the nurse can change the priority at triage.

## How to check in a walk-in patient

1. Select **Find patient to check in** on the Queue screen (or search under **Patients**) and open the patient record. Register the patient
   first if they are new (see [Patients](02-patients.md)).
2. Select **Check in (walk-in)**.
3. Choose the **Visit type \***. Only in-person visit types are listed.
4. Set the **Priority**: **Routine**, **Urgent** or **Emergency**. Urgent and emergency patients are served first.
5. Optionally enter the **Chief complaint** in the patient's words.
6. Under **Assign to**, choose a practitioner or leave **Next available**.
7. Select **Check in**. You return to the queue and a message shows the ticket.

A double click adds the patient only once.

## How to use the queue board

Open **Queue** (`/queue`). The board shows today's visits at the selected facility in five columns:

| Column                 | Meaning                                             |
| ---------------------- | --------------------------------------------------- |
| **Waiting**            | Checked in, not yet seen by anyone                  |
| **Triage / Vitals**    | In triage                                           |
| **Ready for provider** | Triage done (or skipped); waiting for the physician |
| **With provider**      | Consultation in progress                            |
| **Done**               | Seen, cancelled, or left without being seen         |

Each card shows the ticket, the patient's name, a priority badge (**Urgent** or **Emergency**) when not routine, and where the patient was called
to or what they are waiting for. In the waiting columns the card also shows minutes since arrival; waits over 45 minutes are highlighted with ⚠.

The board updates by itself. Next to the count of active visits you see the connection state:

- **Live** — changes appear as they happen.
- **Connecting…** — reconnecting.
- **Updates every 15 s** — live updates are unavailable, so the board re-reads the queue every 15 seconds.

Select **Refresh** to reload at any time.

### Call a patient and move them along

1. Select a ticket. A panel opens on the right with the patient's name, number, age and sex, status, arrival time (appointment or walk-in),
   complaint, and where they were called to.
2. To call the patient, type the place in **Call patient to** (for example "Triage 1" or "Room 3") and select **Call**.
3. To move the patient, use the buttons shown for their current status:
   - From **Waiting**: **Send to triage**, **Cancel visit…**, **Left without being seen…**
   - From **Triage / Vitals**: **Ready for provider**, **Left without being seen…**
   - From **Ready for provider**: **Send to triage** (back to triage), **Left without being seen…**
4. **Cancel visit…** and **Left without being seen…** need a reason (at least 3 characters); it is recorded in the audit trail. Select the
   button again to confirm, or **Keep in queue**.

Calling and moving need `clinic.queue.manage`. From the panel you can also open **Triage & vitals** (or **Update triage** once the patient is
ready for the provider), **Start consultation** or **Open consultation**, **Patient 360** and **Open patient record** — each only if you have the permission
for it.

Once the patient is **With provider**, the panel says "With the provider. The encounter closes the visit." The visit moves to **Done** when the
physician signs the encounter.

Patients who enter the MyHealth waiting room for an online consultation are checked in automatically and appear as **Ready for provider**. Their
panel offers **Open in Telemedicine** instead of **Start consultation**; the consultation starts there (see [Telemedicine](05-telemedicine.md)).

## How to record triage and vital signs

1. On the queue board, select the ticket and then **Triage & vitals**.
2. The page shows the patient banner with allergies, and on the right the patient's **Allergies** and **Previous vitals**. (These need
   `clinical.read`; without it you see "Allergies and previous vitals need clinical access.") You can record allergies here; see
   [Patients](02-patients.md).
3. Under **Assessment**:
   - **Chief complaint \*** — required.
   - **Priority \*** — **Routine**, **Urgent** or **Emergency**. Urgent and emergency patients are seen first.
   - **Pain score (0–10)** — or **Not assessed**.
   - **Risk flags** — comma-separated, for example "fall risk, pregnant, infectious symptoms".
4. Under **Vital signs**, enter what you measured. Leave blank what was not measured. **BMI** is calculated from weight and height for display.
5. Optionally add **Triage notes**.
6. Choose how to save:
   - **Complete triage — ready for provider** — saves and moves the patient to **Ready for provider**.
   - **Save, keep in triage** — saves and leaves the patient in triage (for example while waiting for a repeat reading).
   - **Cancel** — leaves without saving.

You can triage again (for example to add a repeat blood pressure) until the consultation starts. After that the page says "Triage is closed for
this visit".

### Vital-sign limits

The platform refuses values outside these wide limits. They catch typing errors only — they are **not** normal ranges, and the platform does not
label vital signs normal or abnormal.

| Field            | Unit  | Accepted range | Notes                                |
| ---------------- | ----- | -------------- | ------------------------------------ |
| Systolic         | mmHg  | 40–300         | Whole number; record with diastolic  |
| Diastolic        | mmHg  | 20–200         | Whole number; must be below systolic |
| Heart rate       | /min  | 20–300         | Whole number                         |
| Respiratory rate | /min  | 4–80           | Whole number                         |
| Temperature      | °C    | 30–45          |                                      |
| SpO₂             | %     | 50–100         | Whole number                         |
| Weight           | kg    | 0.3–400        |                                      |
| Height           | cm    | 20–260         |                                      |
| Blood glucose    | mg/dL | 10–1500        | Whole number                         |

## How to choose which visit types patients may book online

1. Open **Appointments** and select **Online booking** (`/appointments/visit-types`).
2. The table lists each visit type with **Where** (**In person** or **Online (video)**), **Duration**, **Status** and **Online booking**.
3. Tick the box to open a visit type for booking in MyHealth (**Patients can book**); untick it to make it **Staff only**.

Only active visit types can be opened. Changing this needs `clinic.configure`; without it you see "Only clinic administrators can change these
settings."

Patients book online only inside published schedules. Until a clinic sets its own rules they book at least 2 hours ahead and up to 60 days out, with at
most 3 open bookings, and can change or cancel until 2 hours before. Their bookings appear on your day schedule marked **Booked online by the patient**.

**Booking rules by clinic.** Below the visit types, each facility shows its own rules: **Notice needed (hours)**, **Book up to (days ahead)**, **Upcoming
online bookings per patient**, **Changes and cancellations close (hours before)**, and whether patients may ask to be told when a time opens on a full
day (**Waiting list**, with **Waiting-list requests per patient**). Change the numbers and select **Save rules** (needs `clinic.configure`; the change is
audited). A clinic that never saved rules shows **Platform defaults** and uses them. Turn the waiting list on only if the front desk will work it.

## How to work the waiting list

Select **Waiting list** on the Appointments page (needs `appointment.read`; `appointment.manage` to act). It lists patients waiting for a time at the
selected facility, most urgent and oldest first, with their days, the visit type and doctor they asked for, and whether the patient asked in MyHealth
(**By the patient**) or staff added them (**By staff**). Days that have passed no longer appear.

1. When a time opens (a cancellation, or you make room), patients who asked in MyHealth for that day are texted or emailed automatically; nothing is
   booked for them. To offer a time by phone, call the patient.
2. Select **Book** to open the booking screen for that patient with their doctor, visit type and first day filled in.
3. When the patient no longer needs the entry, select **Remove**, write the reason and confirm. A patient who books a time in the requested days
   through MyHealth is taken off the list by the system.

> Practitioners, their weekly schedules, rooms, visit types, coding systems and leave or closure days are set up by your administrator. There is
> no staff screen for these yet.

## Rules the system enforces

- A practitioner (or room) cannot be double-booked. The database refuses a second booking for the same time, even if two people book at once.
- Appointments cannot start in the past, and staff bookings must fall inside the practitioner's schedule at this facility and not on leave or a
  closure day.
- Only today's appointments can be checked in, and only at the facility where they are booked.
- A patient can have only one active visit per facility at a time.
- A no-show can be recorded only after the start time.
- Cancelling an appointment, cancelling a visit and "left without being seen" all need a reason.
- Queue moves follow a fixed order (see the buttons above); a patient with the provider cannot be moved from the queue.
- Impossible vital signs are refused, never corrected. Systolic and diastolic pressure must be recorded together.
- If someone else changed the appointment or visit a moment before you, your action is refused; the screen reloads so you can see the latest
  state.

## Troubleshooting / common messages

| Message                                                                    | Meaning                                                 | What to do                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| The practitioner is already booked at that time                            | Someone booked this slot first                          | Choose another open slot (the list reloads)                            |
| The room is already booked at that time                                    | The room is taken                                       | Choose another time                                                    |
| The time is outside the practitioner’s schedule at this facility           | No published schedule block covers that time            | Pick a time from **Open slots**, or ask the administrator to add hours |
| The practitioner or facility is unavailable at that time                   | Leave or a closure day                                  | Choose another day                                                     |
| Appointments cannot start in the past                                      | The chosen time has passed                              | Choose a later slot                                                    |
| Only today’s appointments can be checked in                                | The appointment is on another day                       | Check the date; check the patient in as a walk-in if appropriate       |
| The appointment is at another facility                                     | You selected a different facility in the top bar        | Switch facility, or book at this facility                              |
| Cannot check in an appointment that is cancelled (or no show, completed…)  | The appointment is no longer open                       | Book a new appointment or check in as a walk-in                        |
| The patient is already in this facility’s queue                            | The patient has an active visit here today              | Find their ticket on the board                                         |
| A no-show can be recorded only after the start time                        | Too early                                               | Wait until the appointment time has passed                             |
| A reason is required                                                       | Cancel / left without being seen needs a reason         | Enter a reason of at least 3 characters                                |
| The visit is closed                                                        | The visit is already done, cancelled or left            | Refresh the board                                                      |
| Some vital signs are not plausible; check the entries                      | A value is outside the limits; the field is highlighted | Re-measure or correct the typing                                       |
| Triage is not possible while the visit is in consultation (or completed…)  | The consultation has started or the visit is closed     | Record findings in the encounter instead                               |
| … was modified by someone else (expected version …). Reload and try again. | Another user changed it first                           | The screen refreshes; check and try again                              |
| No in-person visit types are configured.                                   | Walk-ins need an in-person visit type                   | Ask your administrator to set one up                                   |

## Related chapters

- [Getting started](01-getting-started.md) — selecting a facility, navigation, the dashboard's live queue
- [Patients](02-patients.md) — search, registration, allergies
- [Consultations and care plans](04-consultations-and-care-plans.md) — what happens after **Ready for provider**
- [Telemedicine](05-telemedicine.md) — online appointments and the waiting room
- [MyHealth patient portal](12-patient-portal.md) — how patients book online
- [Administration](13-administration.md) — roles and permissions
