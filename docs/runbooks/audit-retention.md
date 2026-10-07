# Audit trail retention: monthly partitions, archives and removal

The audit trail (`audit_event`) is partitioned by month (migration `0110`). Nothing is removed unless this deployment
sets a retention period **and** a platform administrator removes an archived month by hand, with a reason. How long
audit records must be kept is the organization's compliance decision (Data Privacy Act, NPC guidance, its own
policies); the platform sets none.

## How the trail is stored

| Partition             | Holds                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `audit_event_history` | Every event recorded before the first of the month after migration `0110` ran (the table as it was, attached without copying). |
| `audit_event_YYYY_MM` | One calendar month in Asia/Manila time.                                                                                        |
| `audit_event_default` | Any event outside every partition (should stay empty; a write is never refused).                                               |

`ensure_audit_partitions()` creates the current month and the next three. `pnpm db:migrate` runs it after every
migration and the API runs it daily (`AuditRetentionService`), so a month's partition exists before its first event.
A partition holds every organization's events, which is why retention is one decision per deployment and only
platform administrators act on it. The append-only rules hold on every partition: the row trigger (cloned by
PostgreSQL), a TRUNCATE trigger on each partition, and the application role (`docs/runbooks/database-roles.md`),
which can neither change rows nor detach or drop a partition.

Staff `/admin/audit` reads through the parent table exactly as before; searches with a date range touch only the
months in it.

## Archive a month

1. **Administration → Sign-in security → Audit trail retention** (platform administrators; `GET
/api/v1/audit/retention/partitions`).
2. **Archive** on a month that has ended (`POST /audit/retention/partitions/<name>/archive`; audited
   `audit.archive-request`). The history partition can be archived once the month it ends in has passed.
3. The API exports the month in the background (oldest first, every column, one JSON object per line, gzipped),
   stores it once at `audit-archive/<partition>/<archive id>.jsonl.gz` in the object storage bucket, reads it back and
   checks its SHA-256, its line count and the month's row count. Only then does it show **Archived, N events**
   (`audit_archive.status = 'verified'`). A failure is retried up to three times and then shown as **Archive failed**
   with the error; archive the month again.
4. **Download** returns the file after checking it against its recorded checksum (audited `audit.archive-download`).
   Keep a copy wherever the organization keeps records it must retain; the bucket's own backups apply too.

The export holds the compressed month in the API's memory while it is written. A very large history partition may
need a larger API instance for the duration.

## Remove an archived month

1. Set `AUDIT_RETENTION_MONTHS` on the API (whole months, 1–1200; Railway variable or Terraform `api_settings`) to the
   period the organization decided, and redeploy. Unset, nothing is removable and the screen says so.
2. A month becomes removable when its archive is verified and its whole range ended at least that many whole months
   before the current month began (Asia/Manila). Example: with 12, September 2025 is removable from 1 October 2026.
3. **Remove from database…**, give the reason (5–500 characters), **Remove** (`POST
/audit/retention/partitions/<name>/remove`). The database function `remove_audit_partition()` checks again that
   the archive is verified, covers the same range and still has the same row count, that the period has passed,
   then detaches and drops the partition and records who removed it, when and why on the archive (once; the archive
   row never changes again and is never deleted). Audited `audit.partition-remove` with the event count and checksum.

A month that received events after it was archived is refused ("changed since it was archived"): archive it again is
not possible while the first archive stands, so record what happened and leave it in place.

## Check

```sql
SELECT * FROM audit_partitions();                                      -- ranges and estimated rows
SELECT count(*) FROM audit_event_default;                              -- should be 0
SELECT partition_name, status, row_count, removed_at FROM audit_archive ORDER BY requested_at;
```

Rows in `audit_event_default` mean a month's partition was missing when they were written (the daily job and the
migration run keep three months ahead). They are kept; `ensure_audit_partitions()` then cannot create that month and
logs a warning. Leave them: the trail stays complete and searchable.

## Restore

A database dump contains every partition, `audit_archive` and the functions. Archives live in object storage and are
restored with the bucket. After a restore, `pnpm db:migrate` creates any missing month ahead and re-applies the
application role's privileges.
