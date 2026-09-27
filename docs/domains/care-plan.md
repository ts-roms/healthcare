# Care plans (`libs/care-plan`)

## Purpose

Longitudinal plans for a patient (CLAUDE.md §9): problems, goals, planned activities (follow-up appointments, laboratory
monitoring, medication, lifestyle, education, referrals, patient and care-team tasks), progress notes, and the recall list.

## Entities

`care_plan` (`draft → active ⇄ on_hold → completed | cancelled`, optimistic lock), `care_plan_problem` (optional link to a
recorded diagnosis), `care_plan_goal` (clinician-set target measure/value — tracked, not interpreted),
`care_plan_activity` (due date, recurrence, status, linked appointment), `care_plan_progress_note` (append-only).

## Rules

- References to diagnoses, encounters and appointments use `(patient_id, id)` foreign keys: they must belong to the
  plan's patient (database-enforced).
- Completing a recurring activity (e.g. HbA1c every 90 days) creates the next occurrence due `interval` days later.
- "Scheduled" requires the linked follow-up appointment.
- Closed plans cannot be edited; cancelling or holding a plan requires a reason.

## Queries

- `GET /care-plans/activities/due?withinDays=&kind=` — **patient recall list**: overdue and upcoming open activities of
  active plans. Each row carries a minimal patient brief (number, name, sex, age) from the `CarePlanPatientDirectory`
  port, implemented in `apps/api` over the patient library (the care-plan library does not import it).
- Open plans with their next activities feed Patient 360.

## Recall reminders

`CarePlanRecallReminders` (started hourly by the API; sends only 08:00–20:00 Manila time) reminds patients of planned,
unbooked `follow_up_appointment` and `laboratory_monitoring` activities of active plans
(`care-plan.rules.ts`, `RECALL_RULES`):

- **due** — from 7 days before the due date; **overdue** — once it is 7 days past due; nothing after 30 days (the
  care team follows up from the recall list).
- One message per patient per day (SMS and MyHealth inbox, template `care-plan.follow-up-due`) covering all their due
  activities; the overdue one leads. It names no condition, test or plan and points to booking in MyHealth or calling.
- Category `clinical` (part of care the clinician planned, not marketing): allowed by default, and the patient's recorded
  preferences (opt-out) and contact rules are applied by `NotificationService`. Suppressed messages are kept in the
  communication history.
- `care_plan_activity_reminder` (append-only, migration `0018_outreach.sql`) records each reminder per activity, due
  date and kind, so each is sent once — across repeated runs and several API instances (advisory lock + idempotency
  keys). The recall list shows when the patient was last reminded (`lastReminderAt`).

Assumption to confirm with each clinic: that care-plan reminders count as care communication rather than outreach under
its privacy notice (NPC guidance); if not, change the template's category to `outreach` (explicit opt-in).

## Events

`CarePlanCreated`, `CarePlanActive|OnHold|Completed|Cancelled`, `CarePlanActivityCompleted`.
Laboratory-monitoring activities will link to laboratory orders in Phase 3.

## Permissions

`care-plan.read`, `care-plan.manage`.

## Staff app

Care plans are created from the encounter workspace and managed on `/clinic/care-plans/[id]`
(`docs/architecture/staff-app.md`). Booking a follow-up for a planned `follow_up_appointment` activity links the
appointment (`status: scheduled`, `appointmentId`).
