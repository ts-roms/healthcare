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

## Least-privilege application role

Migration `0109` creates `healthcare_app`, the role the API and workers connect as through a login role created by the
operator: read and write, but no `UPDATE`/`DELETE` where an append-only trigger forbids it, no `TRUNCATE`, no writes
to `schema_migration` and no DDL. `apply_app_privileges()` derives this from the triggers and `pnpm db:migrate` runs
it after every migration; tests and E2E journeys run the application as such a role. Set-up and rollback:
[database roles runbook](../runbooks/database-roles.md).

## Audit trail partitions and retention

`audit_event` is partitioned by month in Asia/Manila time (migration `0110`): the earlier table is the
`audit_event_history` partition, a default partition catches anything outside the months, and
`ensure_audit_partitions()` keeps the current and next three months ready (after every migration run and daily). A
platform administrator archives a closed month to object storage (`audit_archive`, verified by checksum and row
count) and may remove an archived month past `AUDIT_RETENTION_MONTHS` through `remove_audit_partition()`; unset,
nothing is removed. See the [audit retention runbook](../runbooks/audit-retention.md).

## Production hardening (not yet done)

- Consider row-level security keyed on `organization_id` as defense in depth.
- Encrypted backups and point-in-time recovery; test restores on the hosting provider. The procedure and the checks
  tested locally are in the [backup and restore runbook](../runbooks/backup-and-restore.md).
