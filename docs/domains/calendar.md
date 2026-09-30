# Calendar

## Purpose

A staff calendar for a facility: meetings, events, blocked time, trainings and reminders, shown beside the facility's appointments in month, week and day views. Appointments stay in the appointment tables (booking, check-in and cancellation happen on `/appointments`); the calendar only reads them. Not built: recurring events, invitations that the invitee accepts or declines, reminders/notifications, sync with external calendars, room or equipment booking.

## Entities

- `calendar_event` (migration `0087`): facility, title, kind (`meeting | event | blocked | training | reminder`), `starts_at`/`ends_at` (at most 31 days), `all_day` (whole days of the facility's time zone), location, notes, visibility (`facility | invitees`), status (`scheduled | cancelled`), organizer (user id + name as it was), cancel reason/by/at, optimistic `version`. Events are never deleted.
- `calendar_event_attendee`: the invited users — the organization's active clinicians (practitioners linked to a user).
- Events carry no patient data; the form says so.

## Commands

- Add an event (`calendar.manage`): the caller is the organizer. Attendees must be active practitioners of the organization (`calendar_attendee_invalid`).
- Change an event (organizer, or anyone with `clinic.configure`): replaces its fields and attendees; a stale `version` is `409 version_conflict`.
- Cancel with a reason (3–500 characters): the event stays listed, marked; a cancelled event cannot be changed (`calendar_event_cancelled`).
- Every command is audited (`calendar.event.create | update | cancel`) in the same transaction.

## Queries

- `GET /api/v1/calendar/events?facilityId&from&to` — events overlapping the range (≤ 42 days). `facility` events are seen by everyone with `calendar.read`; `invitees` events only by the organizer and attendees (others get them neither listed nor by id: `404`). Each row has `editable` for the caller.
- `GET /api/v1/appointments?facilityId&from&to` — the existing list gained a range (appointments starting in `[from, to)`, ≤ 42 days, instead of `date`); the calendar pages through it.

## Events

None published.

## Permissions

`calendar.read` (org_admin, physician, nurse, dentist, dental_assistant, receptionist, records_officer) and `calendar.manage` (all of these except dental_assistant and records_officer), migration `0087`. Appointments appear only for users who also hold `appointment.read`.

## API

`GET|POST /calendar/events`, `GET|PUT /calendar/events/:eventId`, `POST /calendar/events/:eventId/cancel` (OpenAPI at `/api/docs`).

## Database relationships

`calendar_event` → `facility` (same organization), `app_user` (organizer, updater, canceller). Constraint checks: end after start, ≤ 31 days, cancellation fields all-or-none.

## Integration points

Staff app `/calendar?view=month|week|day&date=YYYY-MM-DD` (times in the selected facility's time zone; month cells link to the day; appointments link to `/appointments`; a toggle hides appointments).
