# 3. Appointments and queue

## What this is for

This chapter covers a patient's arrival at the clinic: booking an appointment, confirming it, checking the patient in (with an appointment or as a
walk-in), running the facility's queue, and recording triage and vital signs before the consultation. Everything here happens at the facility you
selected in the top bar. Times are shown in that facility's time zone (Asia/Manila unless your organization set another).

## Who uses it

- **Receptionists** book, confirm, cancel and check patients in, and call patients from the queue.
- **Nurses** run the queue and record triage and vital signs.
- **Physicians and dentists** see the queue and start consultations from it (see [Consultations and care plans](04-consultations-and-care-plans.md)).
- **Clinic administrators** set up the visit types, choose which of them patients may book online, and set up each facility's service points.

| Screen               | Where                                                         | Needs                                                    |
| -------------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| Day schedule         | **Appointments** (`/appointments`)                            | `appointment.read`                                       |
| Book appointment     | `/appointments/new` (from the record)                         | `appointment.manage`                                     |
| Visit types          | **Online booking** (`/appointments/visit-types`)              | `appointment.read` to view, `clinic.configure` to change |
| Queue board          | **Queue** (`/queue`)                                          | `clinic.queue.read`; `clinic.queue.manage` to act        |
| Check in walk-in     | `/queue/walk-in` (from the record)                            | `clinic.queue.manage`                                    |
| Triage               | `/queue/visits/[id]/triage`                                   | `clinic.triage.write`                                    |
| Waiting-room display | `/display/queue` (from **Queue**)                             | `clinic.queue.display`                                   |
| Service points       | **Administration → Service points** (`/admin/service-points`) | `clinic.configure`                                       |

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
3. Choose the **Practitioner \***, the **Visit type \*** and the **Day \***. Only practitioners with a current published schedule at this
   facility are listed; online visit types are marked "online" in the list.
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

> Not available in the staff app yet: recurring appointments. The waiting list is under **Waiting list** (see below).

## How to use the calendar

**Calendar** in the menu shows the selected facility's month, week or day. Appointments and staff events appear together (untick **Show appointments** to see events only); click an appointment to open that day's schedule.

1. Choose **New event**, give it a title and a type (meeting, event, blocked time, training or reminder).
2. Set the start and end (or tick **All day**). Times are in the facility's time zone.
3. Choose who can see it: everyone with calendar access, or only you and the clinicians you invite.
4. Choose **Add event**.

Click an event to see it. Only its organizer (or someone who manages clinic set-up) can **Edit** it or **Cancel event…** with a reason. A cancelled event stays on the calendar, struck through. Do not write patient details in an event. Blocking time here does not stop appointments from being booked; change the schedule under **Appointments → Schedules** for that.

## How to confirm, cancel or mark a no-show

On the day schedule, each open appointment (**Booked** or **Confirmed**) shows the actions you may take:

- **Confirm** — for a **Booked** appointment, when the patient has confirmed they will come.
- **Move** — reschedules the appointment (see below).
- **Cancel** — opens a box. Enter a **Reason for cancelling \*** (at least 3 characters, for example "Patient called to cancel"), then select
  **Cancel appointment**. Select **Keep** to leave it booked.
- **No-show** — appears only once the appointment's start time has passed. Marking a no-show may send the patient a "we missed you" message
  inviting them to book again (not if they already have another visit booked), subject to their communication preferences. Where the clinic turned
  on **Automatic no-shows** (see "How to set up visit types and choose which patients may book online"), appointments nobody attended are marked
  for you at the end of the day.

These actions need `appointment.manage`.

Patients receive an SMS reminder about 24 hours before a booked appointment (if their consent and preferences allow). Cancelling or marking a
no-show withdraws a reminder that has not yet been sent.

## How to move (reschedule) an appointment

1. On the day schedule, select **Move** on the appointment. A box opens under it.
2. Keep the **Practitioner** or choose another active practitioner, and choose the **Day** (today or later).
3. Under **Open slots**, pick a time. Only open times in the practitioner's published schedule at this facility are offered (not their leave or
   closures, and not times already booked).
4. If the time the patient needs is outside the published schedule, tick **A time outside the published schedule** and type the **Time**. The
   practitioner still cannot be double-booked.
5. Enter the **Reason \*** (at least 3 characters, for example "Patient asked for an afternoon slot") and select **Move appointment**. Select
   **Keep** to leave it as it is.

The appointment keeps its length and becomes **Booked** again (a confirmation has to be given again). The move and its reason are recorded in the
audit trail. An SMS reminder not yet sent is withdrawn and a new one is scheduled for the new time. The patient is not sent a separate "your
appointment moved" message, so tell them yourself. Needs `appointment.manage`.

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

Open **Queue** (`/queue`). At the top are the page title with the connection state, three chips (the **facility**, the **service point** and the day), and the two buttons a front desk uses most: **Waiting-room display** and **Check in patient**. Below them four figures sum up the queue: **In queue** (with how many are done), **Avg wait**, **Longest wait** (with the patient's name; it turns red with a warning icon at 30 minutes or more) and **With provider**. The board shows today's visits at the selected facility in five columns, filling the screen; each column scrolls on its own:

| Column                 | Meaning                                             |
| ---------------------- | --------------------------------------------------- |
| **Waiting**            | Checked in, not yet seen by anyone                  |
| **Triage / Vitals**    | In triage                                           |
| **Ready for provider** | Triage done (or skipped); waiting for the physician |
| **With provider**      | Consultation in progress                            |
| **Done**               | Seen, cancelled, or left without being seen         |

**Done** is folded into a count with the last ticket; select **View list** to see who they were and **Hide list** to fold it again.

Each card shows the ticket, the patient's name, the complaint or where the patient was called to, and tags: **Walk-in** or **Appointment**, and **Urgent**, **Emergency** or **Priority · …** when not routine. Once the patient has been sent to a service point, the card also shows its name, and **next: …** when their route has a stop ahead. In the waiting columns the card shows how long the patient has waited since arrival, as a coloured label with the minutes: green under 15 minutes, amber from 15, red with a warning icon from 30. These limits are only how the board is drawn; they are not a target set by the system. The selected ticket is outlined.

When nobody has checked in yet, the columns fold into zero counts and the board says **No patients in the queue yet**, with **Check in patient**, **View today's appointments (…)** and who the first appointment of the day is.

If your facility has service points (see below), the **service point** chip in the header shows **All service points** or one of them — for example
only the emergency room's queue. The choice is kept in the page address, so a bookmarked link opens that service point's board and live updates keep
it. Each service point's queue is in the same order as the whole board: emergency, then urgent, then routine, each by arrival.

The board updates by itself. Next to the title you see the connection state and when the board was last updated:

- **Live** — changes appear as they happen.
- **Connecting…** — reconnecting.
- **Updates every 15 s** — live updates are unavailable, so the board re-reads the queue every 15 seconds.

Select the refresh button next to the connection state to reload at any time.

### Call a patient and move them along

1. Select a ticket. A panel opens on the right with the ticket in large type and how long the patient has waited, the patient's name, number, age and sex, the complaint, and four details: **Stage**, **Arrived**, **Visit** (appointment or walk-in) and **Assigned** (the provider, or **Any provider**). It also shows where they were called to, and a **Timeline** of check-in, calls and the current stage. On a narrow screen the panel opens under the board.
2. To call the patient, type the place in **Call patient to** (for example "Triage 1" or "Room 3") and select **Call**.
3. To move the patient, use the buttons shown for their current status:
   - From **Waiting**: **Move to Triage / Vitals**, **Cancel visit…**, **Left without being seen…**
   - From **Triage / Vitals**: **Move to Ready for provider**, **Left without being seen…**
   - From **Ready for provider**: **Send back to Triage / Vitals**, **Left without being seen…**
4. **Cancel visit…** and **Left without being seen…** need a reason (at least 3 characters); it is recorded in the audit trail. Select the
   button again to confirm, or **Keep in queue**.
5. To send a triaged patient somewhere else — from the emergency room to X-ray, say — choose the place under **Send to** and select **Send**. This is
   offered while the patient is **In triage** or **Ready for provider** and only when the facility has service points; the panel shows the
   **Service point** the patient is at. Every move is kept in the visit's history and the audit trail.
6. When the patient has several stops ahead, use the **Route** part of the panel instead of sending them one move at a time (see "How to work a
   patient's route" below).

Calling and moving need `clinic.queue.manage`. From the panel you can also open **Triage & vitals** (or **Update triage** once the patient is
ready for the provider), **Start consultation** or **Open consultation**, **Patient 360** and **Open patient record** — each only if you have the permission
for it.

Once the patient is **With provider**, the panel says "With the provider. The encounter closes the visit." The visit moves to **Done** when the
physician signs the encounter.

Patients who enter the MyHealth waiting room for an online consultation are checked in automatically and appear as **Ready for provider**. Their
panel offers **Open in Telemedicine** instead of **Start consultation**; the consultation starts there (see [Telemedicine](05-telemedicine.md)).

### How to work a patient's route

A route is the planned sequence of service points for one visit — say **Emergency room → Laboratory → X-ray**. It is planned at triage (the
**Route** card) or from the ticket panel. The panel's **Route** section shows the stops in order: done ones ticked, a skipped one struck
through, the one the patient is at marked **here**, and the stops still ahead; **Next:** says where the patient goes next and, if your facility
calls patients automatically, that they will be called there.

- **Done here, send on** — when the patient is finished at the current stop. Add a note if useful (for example "CBC sample taken") and select
  **Send on**: the stop is marked done, the patient moves to the next stop, and — if your facility turned it on under **Administration → Service
  points → Routes** — they are called there at once, so the waiting-room display shows and announces it ("A-002 → Laboratory, 2nd floor") just
  as if you had typed it under **Call patient to**. At the last stop the button reads **Mark done**: the patient stays where they are and the
  route shows **Complete**.
- **Skip step…** — choose the stop to skip and give a reason (at least 3 characters). Skipping a stop still ahead changes nothing else; skipping
  the stop the patient is at sends them on to the next one, as **Done here** would.
- **Plan route…** / **Change next stops…** — choose the stops after the one the patient is at, in order (**Then** → **Add stop**, ✕ to remove one),
  and select **Save route**. This replaces only the stops still ahead; what is done stays. A stop cannot be the same as the one before it. A
  patient still on the ordinary consultation line can be given a route too: **Done here, send on** then takes them to its first stop.

Nothing moves a patient on its own: a sample taken at the laboratory or a procedure recorded does not finish the stop — the person at the station
selects **Done here, send on** when the patient really is done there. Routes need `clinic.queue.manage`, like calling and moving; every step is
kept with the visit and in the audit trail.

## How to set up service points

A larger facility is not one line: after triage a patient may go to the consultation line, the emergency room, X-ray or another station. A clinic
administrator (`clinic.configure`) sets these up under **Administration → Service points** (`/admin/service-points`) for the facility selected in the
top bar:

1. Select **Add a service point**: a **Code** (lower-case letters, digits and hyphens; it cannot change later), a **Name** as staff should see it,
   a **Kind** — **Consultation**, **Emergency**, **Imaging** or **Other** — and optionally a **Location** (up to 60 characters, for example
   "Laboratory, 2nd floor"): what the waiting-room display shows and reads out when a route sends a patient there; the name is used when it is
   empty. The kind only labels and orders the service point at triage and on the board; it adds no rule, and no national list of stations or
   triage scale is built in.
2. **Edit** renames a service point or changes its kind or location. **Deactivate** takes it out of the lists at triage and on the board; patients
   already sent there stay there until moved, and the history keeps the name. **Reactivate** brings it back.
3. Under **Routes**, tick **Call the patient when a route sends them on** and **Save** if the display should announce each move of a route by
   itself. Off (the default), **Done here, send on** moves the patient and staff call them with **Call patient to** as usual.

A facility without service points works as before: one consultation queue. The waiting-room display is unchanged either way — it shows the ticket
and the place you type (or the location configured) when the patient is called, never the service point or the route.

## How to set up the waiting-room display

A screen in the waiting area can show the ticket being called and where to go — for example **A-007 → Room 2** — the tickets called before it,
and how many patients are waiting. It never shows a name, patient number, visit type, priority or complaint, and it does not show the order of
those waiting (urgent patients are seen first, so the order would seem to jump). Online consultations do not appear.

1. An administrator creates a staff account for the screen (see [Administration](13-administration.md)) — for example "Waiting room, Main
   Clinic" — and gives it only the **Waiting-room display** role, for the facility where the screen hangs. If your organization requires
   two-step verification, exempt this account with a reason.
2. On the screen's browser, sign in to the staff app with that account. It opens the display straight away and cannot open anything else.
3. Select **Full screen**. To hear a chime when a ticket is called, open **Sound** and select **Turn on sound** once (browsers only play sound
   after a click on the screen). There you also choose how loud it plays (**Quiet**, **Normal**, **Loud**) and whether the call is read out as
   well — "Number A 0 0 7, please proceed to Room 2" — in **English**, **Filipino** or **Both**, using the voices installed on the screen's
   device (a Filipino voice is not available on every device); **Test** plays what the display will do. The screen remembers the volume and
   voice choice; sound itself is turned on again with one click after the page reloads. The display keeps the screen awake where the browser
   allows it.
4. Call patients from the queue board as usual (**Call patient to** → **Call**). The call appears on the display within a second while it shows
   **Live**; otherwise within 15 seconds.

Receptionists and administrators can also open the display from **Queue** → **Open waiting-room display** (it opens in a new tab). A ticket
leaves the display when the visit is closed (done, cancelled or left without being seen); the display starts empty each day.

## How to record triage and vital signs

1. On the queue board, select the ticket and then **Triage & vitals**.
2. The top of the page shows the ticket, the patient's name, sex, age and patient number, their allergies, **Waiting … min** (amber from 15 minutes, red
   from 30) and whether they walked in or had an appointment. **Open patient record** is on the right. On the right of the form are the patient's
   **Allergies** and **Previous vitals**. (These need `clinical.read`; without it you see "Allergies and previous vitals need clinical access.") You
   can record allergies here; see [Patients](02-patients.md).
3. **1 · Chief complaint \*** — required. The **Common** buttons (Fever, Cough / colds, Headache, Abdominal pain, High blood pressure, Follow-up) add
   those words to what you have written; they are wording only.
4. **2 · Vital signs** — enter what you measured. Leave blank what was not measured. Under each field is the adult reference band until you type, then
   where your reading sits (for example "High · normal 60–100"); a reading outside the band turns red, with the word as well as the colour.
   **BMI** is calculated from weight and height and shown under **Height**. When any reading is outside the band, a **From these vitals** card lists
   them and offers **Set priority to Urgent**. The bands are guidance beside the number; nothing changes the priority or blocks a save unless you press
   that button, and the decision is the nurse's. The bands are for adults: for a patient under 18 the page says so, shows no bands and flags nothing (only the BMI figure), and you read the values against your own references.
5. **3 · Priority & risk**:
   - **Priority \*** — **Routine**, **Urgent** or **Emergency**. Urgent and emergency patients are seen first.
   - **Pain score** — **N/A** or 0 to 10.
   - **Risk flags** — choose from Fall risk, Pregnant, Infectious symptoms, Senior (60+), PWD, Needs interpreter and Wheelchair, or **+ Other** to type
     your own, comma-separated.
6. **4 · Notes for the provider** — optional.
7. When the facility has service points, a **Route** card follows. Under **Send to** choose where the patient goes next — **Consultation**,
   **Emergency room**, **X-ray** or whatever your facility has set up. The list starts on the service point the patient is already at, otherwise on the
   facility's consultation line. Leave it on **Choose…** to keep the ordinary consultation queue. When the patient has more stops ahead — the
   laboratory, then X-ray — add them in order under **Then** (**Add stop**; ✕ removes one). From the queue board, **Done here, send on** then moves the
   patient from stop to stop (see "How to work a patient's route" above). Without service points the bar at the bottom says **No service points set
   up yet** with **Set up rooms** (administrators), and the patient stays on the consultation line.
8. The bar at the bottom says **Next:** where the patient goes, and has the buttons:
   - **Complete triage** — saves and moves the patient to **Ready for provider** (at the service point you chose).
   - **Save draft** — saves and leaves the patient in triage (for example while waiting for a repeat reading); the service point is recorded all the
     same.
   - **Cancel** — leaves without saving.

The triage, the vital signs, the queue move and the service point are saved together: either all of it is recorded or none of it.

You can triage again (for example to add a repeat blood pressure) until the consultation starts. After that the page says "Triage is closed for
this visit".

### Vital-sign limits

The platform refuses values outside these wide limits. They catch typing errors only — they are **not** normal ranges. The adult reference bands shown
beside your readings are a separate, display-only guide for the person reading the number; they are not a diagnosis, are not set per patient (a
child's normal is different) and the platform never acts on them.

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

## When the internet is down (Offline page)

**Who:** reception and nurses. The forms you see depend on your permissions (registration, walk-in check-in, triage).

1. **Before an outage**, open **Offline** once while connected (the yellow banner links to it whenever the connection drops or something
   waits; the address is `/offline`). The page keeps a copy of itself with today's queue and the visit types as of that moment; open it again
   now and then so the copy stays fresh.
2. When the connection is gone, the banner says **No connection**. Open the Offline page. Capture what you need:
   - **Register a patient** (name, sex, birth date, mobile, city).
   - **Check in a walk-in** — a patient you registered here, or a patient number from the patient's card.
   - **Triage and vital signs** — for a visit on the queue copy, or for a walk-in you captured here.
     Each capture appears in the **Outbox** as _Waiting_. Nothing is sent yet.
3. When the connection returns, the outbox sends everything **in the order you captured it** (or select **Send now**). Each item becomes _Sent_,
   with the patient number or ticket the system gave it.
4. An item the system refuses becomes **Needs attention** with the reason — for example _possible duplicates_ with the records to compare, or
   a patient number that matches no one. Do that work on the live screen (register with the duplicate review, or check the number), then
   **Remove** the item. Anything that waited on it (a walk-in for that registration, vitals for that walk-in) needs attention too.

**Things to know:**

- Captured items stay **in this browser tab only**, encrypted. Closing the tab discards what was not sent — send before you close, and do not
  capture on a computer someone else may close.
- The queue copy on the page is as old as the last time it loaded with a connection; it does not update while offline.
- Only these three actions work offline. Consultations, prescriptions, results, billing and printing need the connection.
- Duplicate checking, permissions and every validation happen when an item is sent, exactly as if you had typed it live; nothing is merged or
  overridden automatically.

## How to record a procedure done without a consultation

Some procedures — a wound dressing, an injection, a nebulization — are done by a nurse during a visit without the doctor seeing the patient.
Your clinic decides which procedures these are: an administrator ticks **May be recorded under a visit without a consultation** for the entry
under **Clinic → Procedures**. Staff who may record procedures (physicians and nurses) see **Procedures** on the queue ticket.

1. On the queue board, select the ticket and then **Procedures**. The page lists what was recorded in this visit outside a consultation.
2. Select **Record procedure** and choose the **Procedure** (only entries your clinic allows outside a consultation are offered), who
   **Performed by**, **When** (leave empty for now), the **Body site** if asked, **How many** and the **Notes** (prefilled from your clinic's
   template when there is one — write what applies).
3. If the entry requires consent, the **Consent** part is open: how it was **Obtained** (signed on paper, electronically with the wording shown,
   or in words), **Given by** the patient or a representative (name and relationship), **When obtained** (leave empty for the time of the
   procedure; never after it), a **Signed form** scan if one was uploaded as a consent form document on the patient record, and notes.
   **Print consent form** opens the form with your clinic's current wording for this patient to sign.
4. Select **Record procedure**. If your clinic has priced it, the charge appears at the cashier.

The visit must be open and in person. If the patient is seen by a doctor in the same visit, procedures done in the consultation are recorded in
the encounter workspace instead (see [Consultations](04-consultations-and-care-plans.md)). A mistake is marked **Entered in error…** with a reason.
All of a patient's procedures, in and outside consultations, are listed under **Procedures done here** on the patient record.

## How to set up visit types and choose which patients may book online

Visit types (Consultation, Follow-up, Online consultation…) are what every appointment, walk-in and online booking is made with. A fresh
organization has none: until a clinic administrator adds one, **Book appointment** and **Check in walk-in** say that no visit types are set up.

1. Open **Appointments** and select **Online booking** (`/appointments/visit-types`).
2. The table lists each visit type with its code, **Where** (**In person** or **Online (video)**), **Duration**, **Status** and **Online booking**.
3. To add one, select **Add a visit type…** and fill in the **Name** staff and patients see, a **Code** (2–49 letters, digits or hyphens, unique in
   your organization; it can never be changed), **Where** the visit happens, its **Usual length** in minutes (5–480; the length of the slot offered
   when booking), whether patients go through **Triage before the consultation**, and whether **Patients may book it themselves in MyHealth**. Select
   **Add visit type**.
4. Tick the box to open a visit type for booking in MyHealth (**Patients can book**); untick it to make it **Staff only**.
5. To retire a visit type, select **Deactivate…** on its row and confirm. It is no longer offered for bookings, walk-ins or online booking;
   appointments and visits already recorded keep it, and it stays in the list as **Inactive**. Visit types are never deleted.

Only active visit types can be opened. Adding and deactivating visit types and changing online booking need `clinic.configure` (clinic
administrators); without it you see "Only clinic administrators can change these settings." Every change is audited.

Patients book online only inside published schedules. Until a clinic sets its own rules they book at least 2 hours ahead and up to 60 days out, with at
most 3 open bookings, and can change or cancel until 2 hours before. Their bookings appear on your day schedule marked **Booked online by the patient**.

**Booking rules by clinic.** Below the visit types, each facility shows its own rules: **Notice needed (hours)**, **Book up to (days ahead)**, **Upcoming
online bookings per patient**, **Changes and cancellations close (hours before)**, and whether patients may ask to be told when a time opens on a full
day (**Waiting list**, with **Waiting-list requests per patient**). Change the numbers and select **Save rules** (needs `clinic.configure`; the change is
audited). A clinic that never saved rules shows **Platform defaults** and uses them. Turn the waiting list on only if the front desk will work it.

**When a time opens** decides what the waiting list does with a cancellation: **Tell waiting patients a time may have opened** (they are texted or
emailed and book it themselves), or **Hold the time and offer it to the next patient**. With offers, set **Hold an offered time for (minutes)** and
**Offer each time to (patients at once)**. The patient accepts or declines the held time in MyHealth, or you accept it for them after speaking to them
(see below); the first to accept gets it and the others are told it is taken. A held time that nobody accepts goes to the next patient on the list.
Nothing is ever booked without someone's acceptance.

**Waiting-list rules per visit type or practitioner.** Below the clinic's rules (with a facility selected in the top bar), set whether patients may
join the waiting list for one **visit type** or one **practitioner**, how many **Requests per patient** and **Up to (days ahead)**. The clinic's own
rule applies to everything without a rule here; a practitioner's rule wins over a visit type's. Save with **Add rule** or **Save rule** (needs
`clinic.configure`; audited).

Two more settings sit with the booking rules, both off until you turn them on:

- **Automatic no-shows** — tick **Mark appointments nobody attended as no-shows at the end of the day** and choose **Mark them after** (clinic time,
  from 12:00 PM to 11:00 PM). Every hour after that time, booked or confirmed appointments of that day that ended without a check-in become
  **No-show**, exactly as if someone had selected **No-show**: the patient may get the usual "we missed you" message. Only the last two days are
  looked at, so turning it on does not change older appointments. The audit trail records these as made by the system.
- **Online check-in** — tick **Patients may check in from MyHealth when they arrive** and set **Check-in opens (minutes before)** and **Check-in
  closes (minutes after the start)**. Within that window a patient with an in-person appointment can select **I'm at the clinic — check in** in
  MyHealth. They join the queue **Waiting** for triage with a ticket number, marked **Checked in online**, so look for them in the waiting area.

## How to work the waiting list

Select **Waiting list** on the Appointments page (needs `appointment.read`; `appointment.manage` to act). It lists patients waiting for a time at the
selected facility, most urgent and oldest first, with their days, the visit type and doctor they asked for, and whether the patient asked in MyHealth
(**By the patient**) or staff added them (**By staff**). Days that have passed no longer appear.

1. When a time opens (a cancellation, or you make room), patients who asked in MyHealth for that day are texted or emailed automatically; nothing is
   booked for them. To offer a time by phone, call the patient.
2. Select **Book** to open the booking screen for that patient with their doctor, visit type and first day filled in.
3. When the patient no longer needs the entry, select **Remove**, write the reason and confirm. A patient who books a time in the requested days
   through MyHealth is taken off the list by the system.

**Times being held.** Where the clinic holds opened times (**When a time opens** in the booking rules), the list below shows each held time, who it is
held for, until when, and its state (**Held**, **Accepted**, **Declined**, **Expired**, **Withdrawn**, **Taken by another**). Select **Accept for
patient** after speaking to the patient: the visit is booked at the front desk and the entry closed. Select **Withdraw** with a reason when the time
should not go to that patient; it is not handed on by itself.

## How to see the day by room

On the Appointments page choose **Lay out by: Room**. Each active room of the facility is a column with its bookings (and "Free all day" when it has
none), then **No room** for bookings without one. The calendar's day view has a **By room** tick box that does the same. Rooms are set up under
**Schedules → Rooms**; a booking names its room on the booking screen, and two bookings in the same room cannot overlap.

## How to set up practitioners, schedules, rooms and closures

Select **Schedules** on the appointments page (`/appointments/schedules`). Everyone who can read appointments sees the selected facility's set-up;
changing it needs `clinic.configure` (organization administrators by default). Every change is recorded in the audit trail.

- **Weekly schedules** — who works when at this facility. **Add a weekly schedule…**: choose the practitioner, the day of the week, the hours, the
  slot length in minutes, an optional room, the first day and an optional last day, then **Add schedule**. Booking — by staff and by patients in
  MyHealth — offers only slots inside these schedules. **Retire…** stops a schedule offering new slots; appointments already booked in it stay.
  Two schedules of the same practitioner cannot overlap on the same day.
- **Closures (next 90 days)** — **Add a closure…** for the whole facility (for example a holiday your organization observes) or one practitioner
  (leave): the start, the end and the reason. Its times are no longer offered for booking. Appointments already booked in that time are **not**
  moved or cancelled — move or cancel them yourself.
- **Practitioners** — **Add a practitioner…**: the name patients see, profession, specialty, licence number and its expiry (recorded as given;
  the platform does not check them) and, if the list is shown to you, the staff account that documents and prescribes as this practitioner.
  **Edit…** changes these or makes the practitioner **Inactive** (they can no longer be booked; past records stay).
- **Rooms** — **Add a room…** at this facility (name, code, type). Two appointments in the same room cannot overlap.

Visit types are set up under **Online booking** (`/appointments/visit-types`); diagnosis coding systems have no screen yet (see
[Administration](13-administration.md)).

## How to read a doctor's profile

Select **Doctors** in the menu (`/doctors`) and **View profile** on a card. The profile shows one practitioner at the selected facility:

- **Header** — the name, whether the practitioner is **Active**, profession, specialty and facility. **Edit profile** (needs `clinic.configure`) opens the same form as **Edit…** on the schedules page; **Book appointment** opens the booking screen with this doctor chosen (for staff who may book).
- **Steps left to finish this doctor's profile** — a yellow bar that appears while something is missing: a **staff account** (without one the doctor cannot document or prescribe), the **PRC licence number** (printed on medical certificates and referral letters) or a **weekly schedule** (without one nobody can book the doctor). Each step opens the place where it is fixed. The platform does not check the licence number.
- **Four figures** — **Next available**: the first open slot among the doctor's next clinic days at this facility, for the first in-person visit type; **Hours per week** and the number of clinic days; **Next week**: appointments booked in the coming Monday-to-Sunday week out of the slots the schedule offers that week (a day touched by leave or a closure counts as no slots, even when only part of it is closed); **Seen this month**: the patients with a completed appointment this month (with a **+** after 100 appointments).
- **Weekly schedule** — Monday to Sunday, each with a bar of the hours in clinic within 08:00–20:00 (wider when a schedule starts earlier or ends later), the hours and the number of slots; days without a schedule say **Not in clinic**. **Edit hours** opens the schedules page.
- **Credentials** — the licence number and its expiry, and the linked staff account; a missing one is a link that opens **Edit profile**. A PhilHealth accreditation number is not recorded for individual practitioners.
- **Calendar** — the month with a dot under each clinic day and an orange dot under days of leave; today is filled and the day of the next open slot has a ring. The arrows move by month.
- **Upcoming appointments** — the next days with booked or confirmed appointments (up to three days) with time, patient and reason, how many slots are still open on the first of them, and **See all**, which opens this doctor's schedule. It says when the doctor is not in clinic today.

## Rules the system enforces

- A practitioner (or room) cannot be double-booked. The database refuses a second booking for the same time, even if two people book at once.
- Appointments cannot start in the past, and staff bookings must fall inside the practitioner's schedule at this facility and not on leave or a
  closure day.
- Only today's appointments can be checked in, and only at the facility where they are booked.
- A patient can have only one active visit per facility at a time.
- A no-show can be recorded only after the start time.
- Cancelling an appointment, cancelling a visit and "left without being seen" all need a reason.
- Queue moves follow a fixed order (see the buttons above); a patient with the provider cannot be moved from the queue.
- A patient can be sent to a service point only while **In triage** or **Ready for provider**: triage comes first, a patient with the provider is
  not moved, and a closed visit cannot be sent anywhere. Only an active service point of the same facility can be chosen.
- A route's stops follow the same rule; a stop cannot repeat the one before it; skipping a stop needs a reason; a finished or skipped stop cannot be
  changed; nothing moves a patient along a route without someone selecting **Done here, send on** (or skipping the stop they are at).
- Impossible vital signs are refused, never corrected. Systolic and diastolic pressure must be recorded together.
- If someone else changed the appointment or visit a moment before you, your action is refused; the screen reloads so you can see the latest
  state.

## Troubleshooting / common messages

| Message                                                                                    | Meaning                                                                 | What to do                                                             |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| The practitioner is already booked at that time                                            | Someone booked this slot first                                          | Choose another open slot (the list reloads)                            |
| The room is already booked at that time                                                    | The room is taken                                                       | Choose another time                                                    |
| The time is outside the practitioner’s schedule at this facility                           | No published schedule block covers that time                            | Pick a time from **Open slots**, or ask the administrator to add hours |
| The practitioner or facility is unavailable at that time                                   | Leave or a closure day                                                  | Choose another day                                                     |
| Appointments cannot start in the past                                                      | The chosen time has passed                                              | Choose a later slot                                                    |
| Only today’s appointments can be checked in                                                | The appointment is on another day                                       | Check the date; check the patient in as a walk-in if appropriate       |
| The appointment is at another facility                                                     | You selected a different facility in the top bar                        | Switch facility, or book at this facility                              |
| Cannot check in an appointment that is cancelled (or no show, completed…)                  | The appointment is no longer open                                       | Book a new appointment or check in as a walk-in                        |
| The patient is already in this facility’s queue                                            | The patient has an active visit here today                              | Find their ticket on the board                                         |
| A no-show can be recorded only after the start time                                        | Too early                                                               | Wait until the appointment time has passed                             |
| A reason is required                                                                       | Cancel / left without being seen needs a reason                         | Enter a reason of at least 3 characters                                |
| The visit is closed                                                                        | The visit is already done, cancelled or left                            | Refresh the board                                                      |
| Some vital signs are not plausible; check the entries                                      | A value is outside the limits; the field is highlighted                 | Re-measure or correct the typing                                       |
| Triage is not possible while the visit is in consultation (or completed…)                  | The consultation has started or the visit is closed                     | Record findings in the encounter instead                               |
| A visit that is waiting (or in consultation, completed…) cannot be sent to a service point | Routing needs triage first, or the visit is with the provider or closed | Record triage, or leave the visit as it is                             |
| The patient is already at that service point                                               | Nothing to change                                                       | Choose another service point                                           |
| The visit has no route                                                                     | **Done here, send on** needs planned stops                              | **Plan route…** first, or use **Send to**                              |
| The route is complete; the patient is at the last stop                                     | No stop is left                                                         | **Change next stops…** to add more, or **Send to**                     |
| A stop cannot repeat the one before it                                                     | The same service point twice in a row, or the one the patient is at     | Remove the repeated stop                                               |
| A step that is done (or skipped) cannot be skipped                                         | The step is finished                                                    | Nothing to do; plan further stops if needed                            |
| … is no longer in use (service point)                                                      | The service point was deactivated                                       | Choose another, or ask an administrator to reactivate it               |
| Service point code "…" is already in use at this facility                                  | Codes are unique per facility                                           | Choose another code                                                    |
| … was modified by someone else (expected version …). Reload and try again.                 | Another user changed it first                                           | The screen refreshes; check and try again                              |
| No in-person visit types are configured.                                                   | Walk-ins need an in-person visit type                                   | A clinic administrator adds one under **Online booking**               |
| This procedure is recorded in a consultation (the catalogue does not…)                     | The entry is not allowed outside a consultation                         | Record it in the encounter workspace, or ask an administrator          |
| Record the patient's consent with this procedure                                           | The entry requires consent                                              | Fill in the **Consent** part of the form                               |

## Related chapters

- [Getting started](01-getting-started.md) — selecting a facility, navigation, the dashboard's live queue
- [Patients](02-patients.md) — search, registration, allergies
- [Consultations and care plans](04-consultations-and-care-plans.md) — what happens after **Ready for provider**
- [Telemedicine](05-telemedicine.md) — online appointments and the waiting room
- [MyHealth patient portal](12-patient-portal.md) — how patients book online
- [Administration](13-administration.md) — roles and permissions
