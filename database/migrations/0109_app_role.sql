-- Least privilege for the running application (docs/runbooks/database-roles.md).
--
-- The API and the workers should not connect as the database owner: an owner can alter or drop tables and disable the
-- triggers that keep audit and consent history append-only. This migration creates a group role, `healthcare_app`,
-- with what the application needs and nothing more; the login role the processes use is created once by the operator
-- (with its own password, never in source) as a member of it. Migrations keep running as the owner
-- (MIGRATION_DATABASE_URL, else DATABASE_URL).
--
-- `apply_app_privileges()` grants the role read and write on every table, use of every sequence and execution of every
-- function in the schema, then revokes what the append-only triggers forbid: UPDATE and/or DELETE on each table whose
-- unconditional `prevent_mutation()` row trigger covers that action, and TRUNCATE everywhere. The database then refuses
-- those changes twice — by permission and by trigger — and nothing the application does today changes. The migrator
-- calls the function after every run, so tables and triggers added by later migrations, and a database restored with
-- `pg_restore --no-acl`, are covered without anything to remember. With no separate login role (DATABASE_URL is the
-- owner), nothing changes at all.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'healthcare_app') THEN
    CREATE ROLE healthcare_app NOLOGIN;
  END IF;
END
$$;

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
