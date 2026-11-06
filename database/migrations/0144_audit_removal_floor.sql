-- Zero trust for audit removal (docs/security/zero-trust-audit-2026-11-06.md, D3; docs/runbooks/audit-retention.md).
--
-- Until now remove_audit_partition() trusted its caller for the retention period: the application role, which executes
-- every function in the schema (apply_app_privileges), could pass 1 month and remove any archived month. And the role
-- could insert an archive already marked verified, so "verified" proved nothing. This migration:
--
-- 1. Adds a retention floor that only the database owner sets (audit_retention_floor, one row). The function removes
--    nothing until the owner has set it, and never a month inside the longer of the floor and the caller's period. The
--    application role may read the floor, never write it (apply_app_privileges, below).
-- 2. Makes every archive start as pending, and reach verified only from running (the background runner's path), so
--    a single statement can no longer forge a verified archive.
-- 3. Keeps the owner-only maintenance functions (apply_app_privileges, apply_rls_policies) out of the application
--    role's EXECUTE grant.

-- 1. The owner's floor.
CREATE TABLE audit_retention_floor (
  singleton      boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
  minimum_months integer     NOT NULL CHECK (minimum_months BETWEEN 1 AND 1200),
  set_at         timestamptz NOT NULL DEFAULT now(),
  note           text        CHECK (note IS NULL OR length(note) <= 500)
);
COMMENT ON TABLE audit_retention_floor IS
  'Set by the database owner only (docs/runbooks/audit-retention.md): no audit month is removed before this many whole months, whatever the application asks.';

CREATE OR REPLACE FUNCTION remove_audit_partition(p_partition text, p_retention_months int, p_actor uuid, p_reason text) RETURNS bigint AS $$
DECLARE
  archive audit_archive%ROWTYPE;
  bounds record;
  current_rows bigint;
  floor_months int;
BEGIN
  IF p_retention_months IS NULL OR p_retention_months < 1 THEN
    RAISE EXCEPTION 'No audit retention period is set' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO bounds FROM audit_partitions() WHERE partition_name = p_partition AND NOT is_default;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such audit partition: %', p_partition USING ERRCODE = 'no_data_found';
  END IF;
  SELECT minimum_months INTO floor_months FROM audit_retention_floor;
  IF floor_months IS NULL THEN
    RAISE EXCEPTION 'The database owner has not set an audit retention floor (audit_retention_floor): nothing is removed' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO archive FROM audit_archive WHERE partition_name = p_partition AND status = 'verified' AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit partition % has no verified archive', p_partition USING ERRCODE = 'check_violation';
  END IF;
  IF archive.range_to <> bounds.range_to OR archive.range_from IS DISTINCT FROM bounds.range_from THEN
    RAISE EXCEPTION 'The archive of % does not cover its current range', p_partition USING ERRCODE = 'check_violation';
  END IF;
  IF bounds.range_to > audit_month_start(-greatest(p_retention_months, floor_months)) THEN
    RAISE EXCEPTION 'Audit partition % is within the retention period (at least % months)', p_partition, greatest(p_retention_months, floor_months)
      USING ERRCODE = 'check_violation';
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
REVOKE ALL ON FUNCTION remove_audit_partition(text, int, uuid, text) FROM PUBLIC;

-- 2. Archives start pending and are verified only after running.
CREATE OR REPLACE FUNCTION audit_archive_start_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.row_count IS NOT NULL OR NEW.sha256 IS NOT NULL OR NEW.storage_key IS NOT NULL
       OR NEW.size_bytes IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.removed_at IS NOT NULL THEN
      RAISE EXCEPTION 'An audit archive starts as pending, with nothing written yet' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status = 'verified' AND OLD.status <> 'verified' AND OLD.status <> 'running' THEN
    RAISE EXCEPTION 'An audit archive is verified only by the run that wrote it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_archive_start_guard BEFORE INSERT OR UPDATE ON audit_archive FOR EACH ROW EXECUTE FUNCTION audit_archive_start_guard();

-- 3. The application role's privileges, as in 0109, plus: the floor is read-only to it, and the owner-only
-- maintenance functions are not executable by it.
CREATE OR REPLACE FUNCTION apply_app_privileges() RETURNS void AS $$
DECLARE
  target record;
BEGIN
  EXECUTE 'GRANT USAGE ON SCHEMA public TO healthcare_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO healthcare_app';
  EXECUTE 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO healthcare_app';
  EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO healthcare_app';
  EXECUTE 'REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM healthcare_app';
  -- The migration ledger is read, never written, by the application.
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON schema_migration FROM healthcare_app';
  -- The audit retention floor is the owner's (0144).
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON audit_retention_floor FROM healthcare_app';
  -- Owner-only maintenance, run by the migrator.
  EXECUTE 'REVOKE EXECUTE ON FUNCTION apply_app_privileges() FROM healthcare_app';
  IF to_regprocedure('apply_rls_policies()') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION apply_rls_policies() FROM healthcare_app';
  END IF;
  -- What an unconditional prevent_mutation() row trigger forbids (tgtype bits: 1 row, 8 delete, 16 update).
  FOR target IN
    SELECT c.relname,
           bool_or(t.tgtype & 16 <> 0) AS forbids_update,
           bool_or(t.tgtype & 8 <> 0) AS forbids_delete
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public' AND p.proname = 'prevent_mutation' AND NOT t.tgisinternal AND t.tgenabled <> 'D'
      AND t.tgtype & 1 <> 0 AND t.tgqual IS NULL AND cardinality(t.tgattr::int2[]) = 0
    GROUP BY c.relname
  LOOP
    IF target.forbids_update THEN
      EXECUTE format('REVOKE UPDATE ON %I FROM healthcare_app', target.relname);
    END IF;
    IF target.forbids_delete THEN
      EXECUTE format('REVOKE DELETE ON %I FROM healthcare_app', target.relname);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

SELECT apply_app_privileges();
