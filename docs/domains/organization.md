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

Steps live in `apps/staff/src/lib/tour.ts`; the overlay is `apps/staff/src/components/guided-tour.tsx`, mounted by `StaffShell`.
