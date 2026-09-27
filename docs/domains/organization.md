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
