# Runbook — backing up and restoring the platform

**When:** backups on the schedule the organization sets; a restore after data loss, corruption or a failed release, and
a restore drill at least as often as the organization's policy requires. **Who:** operators with access to the
database, the object storage bucket, the secrets store and deployments. **Downtime:** a restore replaces the database,
so the API and workers are stopped while it runs.

This runbook covers how the platform's data is laid out and the procedure that has been tested. It does **not** set the
backup schedule, retention, encryption method, off-site location, recovery point or recovery time objectives: those
are decisions for the organization and its hosting provider (see [Decisions still open](#decisions-still-open)), and
the [compliance register](../security/compliance-dependencies.md) keeps the item open until they are made and a
restore has been tested in the real environment.

## What holds the data

| Store                        | What is in it                                                                                                                                                                                                                                                                                                                                        | Back up?                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| PostgreSQL (`DATABASE_URL`)  | Every record: patients, clinical history, results, billing, audit trail (`audit_event`, monthly partitions; `audit_archive` records archived months), outbox events, queued notifications and exchanges, `schema_migration` (applied migrations with checksums). Document **metadata** (`document.storage_key`), not the files.                      | **Yes** — the system of record.             |
| Object storage (`S3_BUCKET`) | Archived audit months under `audit-archive/` ([audit retention runbook](audit-retention.md)); document files under `org/<organization>/documents/<id>`: uploads, archived lab reports, certificates, referral letters, record copies, dental images. Generated documents are written with a conditional put (`If-None-Match: *`) and never replaced. | **Yes** — files exist only here.            |
| Secrets store                | `MFA_ENCRYPTION_KEY` (staff and patient TOTP secrets), `INTEGRATION_PAYLOAD_KEY(S)` (sealed integration payloads and FHIR import content), `JWT_ACCESS_SECRET`, provider credentials.                                                                                                                                                                | **Yes, separately** — never next to a dump. |
| Redis (`REDIS_URL`)          | BullMQ queues (`notifications`, `lab-report-archive`, `integrations`; finished jobs are removed, the database is the record) and the API's rate-limit counters (`throttle:*`, expire within minutes).                                                                                                                                                | No — rebuilt from the database (see below). |

A database dump without the matching `MFA_ENCRYPTION_KEY` restores, but enrolled two-step verification secrets cannot
be read (those users need an administrator reset); without the payload keys, sealed payloads and kept FHIR import
content cannot be opened. Keep every key version that encrypted data still in a backup may need, for as long as that
backup is kept ([key rotation](integration-payload-key-rotation.md)).

## Database backup (logical dump)

`pg_dump` takes a consistent snapshot of a running database, so the API does not need to stop. Use a `pg_dump` of the
server's major version or newer (the platform needs PostgreSQL 16+).

```sh
pg_dump --format=custom --no-owner --no-acl --file="healthcare-$(date -u +%Y%m%dT%H%M%SZ).dump" "$DATABASE_URL"
pg_restore --list healthcare-<timestamp>.dump > /dev/null   # the file is readable
```

- The dump holds patient data in clear. Encrypt it before it leaves the host and store it where only the operators who
  restore can read it. The tool and location are the organization's decision.
- A logical dump restores to the moment it was taken. Point-in-time recovery needs the provider's continuous backup or
  WAL archiving; whether the hosting provider offers it, and for how long, must be checked in its current documentation
  and contract — this repository does not configure it.

## Object storage backup

Back the bucket up with the provider's own mechanism (versioning, replication to a second bucket or region, or a
scheduled copy). Each document has its own key and generated documents are never overwritten, so a copy that only
adds objects keeps them all. Which mechanism, how long copies are kept and where they live are decisions for the organization; nothing in this
repository sets them, and a bucket restore has **not** been tested.

## Restore

1. **Stop writers.** Stop the `api`, `notification-worker` and `integration-worker` services so nothing writes while
   the database is replaced. An `apps/instrument-gateway` retries an ASTM transmission a few times over about two
   minutes and then logs it as failed (`astm.transmission` with a reason); resend results sent while the API was down
   from the analyzer.
2. **Restore the database into a new, empty database** (keep the damaged one until the restore is accepted). The
   owning role does not need to be a superuser: `pg_trgm` and `btree_gist` are trusted extensions the database owner
   may create.

   ```sh
   createdb --owner=<app role> healthcare_restored        # or the provider's console
   pg_restore --no-owner --no-acl --exit-on-error --dbname="postgres://<app role>@<host>/healthcare_restored" healthcare-<timestamp>.dump
   ```

   Restore the whole dump, never `--data-only` into an existing schema: the full restore loads the rows before it
   creates the triggers, while a data-only load fires them, and they can refuse valid rows (for example care filed
   under a patient record that was merged later).

3. **Check the restore** before anything connects to it (see [Checks](#checks)).
4. **Object storage:** use a bucket state from the same time as the dump or later. A later bucket only has extra files
   without a `document` row (harmless, but they still hold patient data: list them, do not delete them without the
   organization's retention decision). An earlier bucket leaves rows whose files are missing — the screens then fail to
   open those documents.
5. **Point the services at the restored database** (`DATABASE_URL`) with the same keys as before. Deploy `api` first:
   its pre-deploy `pnpm db:migrate` applies only migrations newer than the dump, and fails if an applied migration file
   has changed.
6. **Review outgoing work before starting the workers** — see [After a restore](#after-a-restore). Then start the
   notification and integration workers, `staff` and `portal`.
7. Record the restore (when, which dump, why, who, the checks' output) in the organization's incident log.

## Checks

Row counts per table, from the source when it is still readable, or from the restored database for the incident log:

```sql
SELECT table_name,
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text AS rows
FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;
```

Schema objects and migrations:

```sql
SELECT (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal) AS triggers,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public') AS indexes,
       (SELECT string_agg(extname, ',' ORDER BY extname) FROM pg_extension) AS extensions,
       (SELECT max(name) FROM schema_migration) AS last_migration;
```

```sh
pnpm db:migrate "postgres://<app role>@<host>/healthcare_restored"   # expect "0 applied" for a dump of the current release
```

The run also puts back the application role's privileges (`apply_app_privileges()`), which `--no-acl` leaves out; the
login role itself belongs to the server, not the dump, and is created again on a new server
([database roles runbook](database-roles.md)).

The append-only triggers are in place when a change to the audit trail is refused:

```sql
UPDATE audit_event SET action = action WHERE id = (SELECT id FROM audit_event LIMIT 1);   -- must fail (prevent_mutation)
```

Documents whose files should exist, to compare with a listing of the bucket:

```sql
SELECT storage_key FROM document WHERE status IN ('available', 'archived') ORDER BY storage_key;
```

## After a restore

The database is back at the dump's moment, so anything that happened after it is gone from the record, and work that
was still waiting then is waiting again:

- **Notifications** in `queued` or `sending` are re-enqueued by the notification worker within minutes (queued > 2 min,
  sending > 15 min). Some of them may already have reached the patient after the dump. Before starting the worker, list
  them and decide with the organization whether to send them again:

  ```sql
  SELECT status, channel, template_key, count(*) FROM notification WHERE status IN ('queued', 'sending') GROUP BY 1, 2, 3;
  ```

- **Integration exchanges** waiting at the dump are re-enqueued by the integration worker's reconciler (every 5 min).
  While no adapter is configured they end as not configured; with an adapter, an exchange sent after the dump may be
  sent again — check with the receiving system before starting the worker.
- **Archived laboratory reports** pending at the dump are re-queued; when the file was already stored after the dump,
  the conditional put finds it and the archive reuses it.
- **Redis:** stale jobs for rows that no longer exist are skipped (the workers claim each row in the database first).
  Flushing Redis is not required.
- **Sessions and tokens** issued after the dump no longer exist: staff and patients sign in again. Anything they did
  after the dump (results entered, payments recorded, messages, documents uploaded) must be re-entered from paper or
  other records — the organization decides how, and the audit trail of the damaged database, if readable, helps
  reconstruct it.

## Restore drill

Restore the latest dump into a separate database, run the [Checks](#checks), then drop it. The drill must never use a
database that tests point at: `pnpm test:integration` and `pnpm test:e2e` wipe theirs.

What has been verified in this repository (local PostgreSQL 16.13, a database populated by an integration test run):
a custom-format dump of 215 tables restored with `--no-owner --no-acl --exit-on-error` by a role without superuser
rights; every table's row count matched the source; trigger, constraint and index counts and the extensions matched;
`pnpm db:migrate` against the restored database applied nothing (92 migrations, checksums equal); the append-only
trigger refused an `UPDATE` on `audit_event`. Not verified: object storage backup and restore, point-in-time recovery,
restore on the hosting provider, restore time for a production-sized database.

## Decisions still open

| Decision                                                                                                                                       | Owner                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Backup schedule and how long dumps and object copies are kept                                                                                  | Operations lead, data protection officer  |
| Recovery point and recovery time objectives                                                                                                    | Organization management, operations lead  |
| Encryption tool and where encrypted backups are stored (off-site)                                                                              | Operations lead, data protection officer  |
| Point-in-time recovery and bucket versioning on the provider                                                                                   | Operations lead, hosting provider terms   |
| How often restore drills run and who signs them off                                                                                            | Operations lead                           |
| Re-sending notifications and exchanges after a restore                                                                                         | Organization (clinical and records leads) |
| Rebuilding the hosting environment itself: the checklist in [railway.md](../deployment/railway.md#what-is-codified-and-what-is-not) (ADR-0010) | Operations lead                           |
