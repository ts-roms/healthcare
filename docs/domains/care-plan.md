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

- `GET /care-plans/activities/due?withinDays=` — **patient recall list**: overdue and upcoming open activities of
  active plans.
- Open plans with their next activities feed Patient 360.

## Events

`CarePlanCreated`, `CarePlanActive|OnHold|Completed|Cancelled`, `CarePlanActivityCompleted`.
Laboratory-monitoring activities will link to laboratory orders in Phase 3.

## Permissions

`care-plan.read`, `care-plan.manage`.
