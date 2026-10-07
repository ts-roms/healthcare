-- Audit trail: monthly partitions and an archive-then-remove retention procedure (docs/runbooks/audit-retention.md).
--
-- `audit_event` becomes a table partitioned by `occurred_at`, one partition per calendar month in Asia/Manila time.
-- Nothing is copied: the existing table is renamed `audit_event_history` and attached as the partition for everything
-- before the first of next month (Postgres scans it once to check the range and builds the new primary key index).
-- A default partition catches any row outside the partitions, so a write is never refused. The primary key becomes
-- (id, occurred_at), as partitioning requires; nothing looks a row up by id alone.
--
-- The append-only rules carry over: the row trigger is cloned onto every partition by Postgres, and the statement
-- TRUNCATE trigger, which is not, is added to each partition here and by ensure_audit_partitions(). The application
-- role (0109) cannot update, delete, truncate, detach or drop.
--
-- Retention: a platform administrator archives a closed month to object storage (compressed JSON lines, row count and
-- SHA-256 recorded, read back and verified; `audit_archive`). Only an archived and verified partition older than the
-- deployment's AUDIT_RETENTION_MONTHS can be removed, by a separate audited request, through remove_audit_partition()
-- (detach and drop, as the owner). With no retention period set nothing is ever removed. A partition holds every
-- organization's rows, so retention is one decision per deployment, not per organization.

-- 1. The existing table becomes the history partition.
ALTER TABLE audit_event RENAME TO audit_event_history;
DROP TRIGGER audit_event_no_update_delete ON audit_event_history;
DROP TRIGGER audit_event_no_truncate ON audit_event_history;
ALTER TABLE audit_event_history DROP CONSTRAINT audit_event_pkey;
ALTER INDEX audit_event_org_time_idx RENAME TO audit_event_history_org_time_idx;
ALTER INDEX audit_event_patient_time_idx RENAME TO audit_event_history_patient_time_idx;
ALTER INDEX audit_event_actor_time_idx RENAME TO audit_event_history_actor_time_idx;
ALTER INDEX audit_event_resource_idx RENAME TO audit_event_history_resource_idx;

-- 2. The partitioned table, with the same columns and checks (named as on the history partition, which must match).
CREATE TABLE audit_event (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  occurred_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  organization_id  uuid,
  facility_id      uuid,
  actor_type       text        NOT NULL,
  actor_user_id    uuid,
  action           text        NOT NULL,
  resource_type    text        NOT NULL,
  resource_id      text,
  patient_id       uuid,
  outcome          text        NOT NULL,
  reason           text,
  changes          jsonb,
  metadata         jsonb,
  request_id       text,
  ip_address       text,
  user_agent       text,
  CONSTRAINT audit_event_actor_type_check CHECK (actor_type IN ('user', 'patient', 'system', 'anonymous')),
  CONSTRAINT audit_event_action_check CHECK (action ~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$'),
  CONSTRAINT audit_event_outcome_check CHECK (outcome IN ('success', 'denied', 'failure')),
  CONSTRAINT audit_event_check CHECK (actor_type NOT IN ('user', 'patient') OR actor_user_id IS NOT NULL),
  CONSTRAINT audit_event_pkey PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
CREATE INDEX audit_event_org_time_idx      ON audit_event (organization_id, occurred_at DESC);
CREATE INDEX audit_event_patient_time_idx  ON audit_event (patient_id, occurred_at DESC) WHERE patient_id IS NOT NULL;
CREATE INDEX audit_event_actor_time_idx    ON audit_event (actor_user_id, occurred_at DESC) WHERE actor_user_id IS NOT NULL;
CREATE INDEX audit_event_resource_idx      ON audit_event (resource_type, resource_id);

CREATE TRIGGER audit_event_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();

-- The first of a month in Asia/Manila, `offset_months` from the current one.
CREATE OR REPLACE FUNCTION audit_month_start(offset_months int) RETURNS timestamptz AS $$
  SELECT (date_trunc('month', now() AT TIME ZONE 'Asia/Manila') + make_interval(months => offset_months)) AT TIME ZONE 'Asia/Manila';
$$ LANGUAGE sql STABLE;

DO $$
BEGIN
  EXECUTE format('ALTER TABLE audit_event ATTACH PARTITION audit_event_history FOR VALUES FROM (MINVALUE) TO (%L)', audit_month_start(1));
END
$$;
CREATE TABLE audit_event_default PARTITION OF audit_event DEFAULT;
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON audit_event_history FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON audit_event_default FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();

-- 3. Monthly partitions ahead of time: the current month and `months_ahead` more (named audit_event_YYYY_MM). Runs as
-- the owner (SECURITY DEFINER) because the application role creates nothing; called after every migration run and
-- daily by the API. A month already covered (the history partition) is skipped; a month whose rows already sit in the
-- default partition cannot be created (Postgres refuses) and is reported as a warning — they stay where they are.
CREATE OR REPLACE FUNCTION ensure_audit_partitions(months_ahead int DEFAULT 3) RETURNS int AS $$
DECLARE
  created int := 0;
  month_start timestamptz;
  partition text;
BEGIN
  FOR i IN 0..months_ahead LOOP
    month_start := audit_month_start(i);
    partition := 'audit_event_' || to_char(month_start AT TIME ZONE 'Asia/Manila', 'YYYY_MM');
    CONTINUE WHEN to_regclass('public.' || partition) IS NOT NULL;
    BEGIN
      EXECUTE format('CREATE TABLE %I PARTITION OF audit_event FOR VALUES FROM (%L) TO (%L)', partition, month_start, audit_month_start(i + 1));
      EXECUTE format('CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation()', partition);
      created := created + 1;
    EXCEPTION
      WHEN invalid_object_definition THEN NULL; -- overlaps an existing partition (the history partition)
      WHEN check_violation THEN RAISE WARNING 'audit partition % not created: the default partition holds rows of that month', partition;
    END;
  END LOOP;
  RETURN created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- The partitions of the audit trail with their ranges (null bound = unbounded) and the planner's row estimate.
CREATE OR REPLACE FUNCTION audit_partitions()
RETURNS TABLE (partition_name text, range_from timestamptz, range_to timestamptz, is_default boolean, estimated_rows bigint) AS $$
  SELECT c.relname::text,
         CASE WHEN b.parts[1] = 'MINVALUE' THEN NULL ELSE trim(both '''' from b.parts[1])::timestamptz END,
         CASE WHEN b.parts[2] = 'MAXVALUE' THEN NULL ELSE trim(both '''' from b.parts[2])::timestamptz END,
         b.parts IS NULL,
         greatest(c.reltuples, 0)::bigint
  FROM pg_inherits i
  JOIN pg_class c ON c.oid = i.inhrelid
  CROSS JOIN LATERAL (SELECT regexp_match(pg_get_expr(c.relpartbound, c.oid), '^FOR VALUES FROM \((.*)\) TO \((.*)\)$') AS parts) b
  WHERE i.inhparent = 'public.audit_event'::regclass
  ORDER BY b.parts IS NULL, 2 NULLS FIRST;
$$ LANGUAGE sql STABLE;

SELECT ensure_audit_partitions(3);

-- 4. Archives of closed months. One archive that is not failed per partition; once verified only its removal is
-- recorded, once; never deleted.
CREATE TABLE audit_archive (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  partition_name   text        NOT NULL CHECK (partition_name ~ '^audit_event_(history|\d{4}_\d{2})$'),
  range_from       timestamptz,
  range_to         timestamptz NOT NULL,
  status           text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'verified', 'failed')),
  row_count        bigint      CHECK (row_count >= 0),
  size_bytes       bigint      CHECK (size_bytes >= 0),
  sha256           text        CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key      text,
  attempts         integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error       text        CHECK (length(last_error) <= 2000),
  requested_by     uuid        NOT NULL REFERENCES app_user (id),
  requested_at     timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  heartbeat_at     timestamptz,
  completed_at     timestamptz,
  removed_at       timestamptz,
  removed_by       uuid        REFERENCES app_user (id),
  removal_reason   text        CHECK (removal_reason IS NULL OR length(btrim(removal_reason)) BETWEEN 5 AND 500),
  CHECK (range_from IS NULL OR range_from < range_to),
  CHECK ((status = 'verified') = (row_count IS NOT NULL AND sha256 IS NOT NULL AND storage_key IS NOT NULL AND size_bytes IS NOT NULL)),
  CHECK ((status IN ('verified', 'failed')) = (completed_at IS NOT NULL)),
  CHECK ((removed_at IS NULL) = (removed_by IS NULL) AND (removed_at IS NULL) = (removal_reason IS NULL)),
  CHECK (removed_at IS NULL OR status = 'verified')
);
CREATE UNIQUE INDEX audit_archive_one_per_partition ON audit_archive (partition_name) WHERE status <> 'failed';
CREATE INDEX audit_archive_pending ON audit_archive (requested_at) WHERE status IN ('pending', 'running');

-- Never deleted; a verified or failed archive never changes except that a verified one records its removal, once.
CREATE OR REPLACE FUNCTION audit_archive_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_archive rows are never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('verified', 'failed') THEN
    IF OLD.removed_at IS NOT NULL OR OLD.status = 'failed'
       OR (to_jsonb(NEW) - 'removed_at' - 'removed_by' - 'removal_reason') <> (to_jsonb(OLD) - 'removed_at' - 'removed_by' - 'removal_reason') THEN
      RAISE EXCEPTION 'A finished audit archive never changes, except to record its removal once' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.id <> OLD.id OR NEW.partition_name <> OLD.partition_name OR NEW.requested_by <> OLD.requested_by THEN
    RAISE EXCEPTION 'An audit archive keeps its partition and requester' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_archive_guard BEFORE UPDATE OR DELETE ON audit_archive FOR EACH ROW EXECUTE FUNCTION audit_archive_guard();

-- 5. Removal, as the owner: only a partition whose verified archive still matches it (same range, same row count),
-- whose whole range ended at least `retention_months` whole months before the current month began. Detaches and
-- drops the partition and records the removal on the archive; returns the number of events removed.
CREATE OR REPLACE FUNCTION remove_audit_partition(p_partition text, p_retention_months int, p_actor uuid, p_reason text) RETURNS bigint AS $$
DECLARE
  archive audit_archive%ROWTYPE;
  bounds record;
  current_rows bigint;
BEGIN
  IF p_retention_months IS NULL OR p_retention_months < 1 THEN
    RAISE EXCEPTION 'No audit retention period is set' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO bounds FROM audit_partitions() WHERE partition_name = p_partition AND NOT is_default;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such audit partition: %', p_partition USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO archive FROM audit_archive WHERE partition_name = p_partition AND status = 'verified' AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit partition % has no verified archive', p_partition USING ERRCODE = 'check_violation';
  END IF;
  IF archive.range_to <> bounds.range_to OR archive.range_from IS DISTINCT FROM bounds.range_from THEN
    RAISE EXCEPTION 'The archive of % does not cover its current range', p_partition USING ERRCODE = 'check_violation';
  END IF;
  IF bounds.range_to > audit_month_start(-p_retention_months) THEN
    RAISE EXCEPTION 'Audit partition % is within the retention period', p_partition USING ERRCODE = 'check_violation';
  END IF;
  EXECUTE format('SELECT count(*) FROM %I', p_partition) INTO current_rows;
  IF current_rows <> archive.row_count THEN
    RAISE EXCEPTION 'Audit partition % changed since it was archived', p_partition USING ERRCODE = 'check_violation';
  END IF;
  EXECUTE format('ALTER TABLE audit_event DETACH PARTITION %I', p_partition);
  EXECUTE format('DROP TABLE %I', p_partition);
  UPDATE audit_archive SET removed_at = now(), removed_by = p_actor, removal_reason = p_reason WHERE id = archive.id;
  RETURN current_rows;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Only through these functions: never by the application role directly.
REVOKE ALL ON FUNCTION ensure_audit_partitions(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION remove_audit_partition(text, int, uuid, text) FROM PUBLIC;
