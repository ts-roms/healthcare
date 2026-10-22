# Organization (`libs/organization`)

## Purpose

Tenancy structure: organizations (the data boundary), facilities (clinics,
laboratories, dental clinics, …) and departments.

## Entities

`organization` (code, name, status), `facility` (type, Philippine address,
contact, license number for reference, timezone, status, version),
`department` (per facility).

## Commands

Create organization (platform admin), create/update facility (optimistic lock,
diff audited), create department.

## Queries

Current organization, facilities, facility detail, departments.
`findFacility` / `findDepartment` are used by the access guard.

## Permissions

`organization.read`, `organization.manage`.

## Notes

License numbers are recorded, not validated; facility licensing rules are
regulatory requirements to confirm with DOH (CLAUDE.md §36).

## Guided tour of the staff app (migration 0124)

The staff app offers a short spotlight walk-through (menu, search, facility, notifications, help, account) the first time a browser opens it. Two switches decide whether it appears:

- **Organization** (`staff_tour_setting`, one row per organization, no row = on): `GET /organization/tour-setting` (any signed-in member of staff, no patient data) and `PUT` (`organization.manage`, optimistic `version`, audited `tour.setting.update`). Staff `/admin/guided-tour` (Settings → Organization). Off = the tour never starts and cannot be started.
- **Person, per browser** (local storage, nothing sent to the server): the switch and "Start the tour now" on My account; the tour starts by itself once per tour version.

**Tours.** One for the app (menu, search, facility, notifications, help, account), one overview of a patient's visit from check-in to completion (`care-journey`, with a link to each screen) and one per main screen: patients, registration, patient record, appointments, booking, queue, walk-in check-in, triage, consultations, the consultation workspace, laboratory workbench, billing desk, patient billing, invoice, pharmacy, online consultations, dental, inventory, messages, records requests and management. A screen's tour starts by itself once, the first time it is opened in a browser; any tour can be started from My account (the list shows the tours for the screens the person may open) and **Tour this page** in the account menu.

Content is in `apps/staff/src/lib/tour-steps.ts`; the engine (what was seen per tour and version, selectors) in `apps/staff/src/lib/tour.ts`; the overlay is `apps/staff/src/components/guided-tour.tsx`, mounted by `StaffShell`. Targets use existing aria-labels, ids and headings (`card:`, `section:`, `button:` text selectors); a target that is not on screen is shown as a centred card, so a tour never blocks a page. Raise a tour's `version` to show it again.
