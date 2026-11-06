-- Zero trust for the audit trail's partitions (docs/security/zero-trust-audit-2026-11-06.md, D6).
--
-- Row-level security is enabled on audit_event, and PostgreSQL applies the parent's policies only to queries through
-- the parent. apply_app_privileges() granted the application role every table, partitions included, so
-- `SELECT * FROM audit_event_default` (or a month's partition) returned every organization's audit events. The
-- application never names a partition (it reads and writes audit_event; the archive and removal go through
-- audit_event or the owner's SECURITY DEFINER functions), so the role now holds nothing on the partitions themselves:
-- access through the parent is checked on the parent only, and its policy applies.

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
  -- The audit trail's partitions are reached only through audit_event, whose row-level security applies to them
  -- (0146): a partition named directly would bypass it. Partitions created later by ensure_audit_partitions() get no
  -- grant in the first place.
  FOR target IN
    SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = 'public.audit_event'::regclass
  LOOP
    EXECUTE format('REVOKE ALL ON %I FROM healthcare_app', target.relname);
  END LOOP;
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
