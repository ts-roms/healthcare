# Database

PostgreSQL 16. Schema source of truth: `database/migrations/*.sql`.

## Migrations

- Forward-only, numbered `NNNN_description.sql`, applied in order by `pnpm db:migrate`.
- Each file runs in its own transaction; applied files are checksummed. **Never
  edit an applied migration** — add a new one.
- Adding a permission requires a migration that inserts it into `permission`;
  the API refuses to start if the code catalog and the table differ.

## Conventions

| Convention                                                                       | Why                                                                                |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `uuid` primary keys (`gen_random_uuid()`)                                        | No enumerable ids in URLs                                                          |
| `organization_id` on every tenant table; composite FKs `(organization_id, x_id)` | The database itself guarantees records never reference another organization's data |
| `timestamptz` everywhere; dates of birth as `date`                               | Unambiguous instants; displayed in Asia/Manila                                     |
| `version integer` on editable aggregates                                         | Optimistic locking (`version_conflict`)                                            |
| `status` + `retired_at/_by` instead of `DELETE`                                  | Clinical history is never silently lost                                            |
| Append-only tables guarded by `prevent_mutation()` trigger                       | `audit_event`, `patient_consent`                                                   |
| Check constraints for enumerations and cross-column rules                        | Invariants hold regardless of the caller                                           |
| No large binaries                                                                | Files live in object storage; `document` holds metadata                            |

## Phase 1 tables

| Area              | Tables                                                                                                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared            | `schema_migration`, `idempotency_record`                                                                                                                                                            |
| Audit             | `audit_event` (append-only, no FKs by design)                                                                                                                                                       |
| Organization      | `organization`, `facility`, `department`                                                                                                                                                            |
| Identity & access | `app_user`, `permission`, `role`, `role_permission`, `organization_membership`, `role_assignment`, `auth_session`                                                                                   |
| Patient           | `patient`, `patient_number_sequence`, `patient_identifier`, `patient_contact_point`, `patient_address`, `patient_relationship`, `patient_consent` (append-only), `patient_communication_preference` |
| Documents         | `document`                                                                                                                                                                                          |
| Notifications     | `notification`, `notification_attempt`                                                                                                                                                              |

## Production hardening (not yet done)

- Run the API as a role without `UPDATE`/`DELETE`/`TRUNCATE` on `audit_event`
  and `patient_consent` (the triggers are a second line of defense).
- Consider row-level security keyed on `organization_id` as defense in depth.
- Partition `audit_event` by month once volume warrants it; define retention.
- Encrypted backups and point-in-time recovery; test restores (see runbooks).
