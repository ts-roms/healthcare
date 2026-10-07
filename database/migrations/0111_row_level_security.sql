-- Row-level security per organization (docs/runbooks/database-roles.md, "Row-level security").
--
-- A second line of defence behind the application's own organization filters: on every table with an
-- `organization_id`, the application role sees and writes only the rows of the organization its connection is stamped
-- with (`app.organization_id`), unless the connection carries the platform scope (`app.scope = 'all'`) for work that
-- crosses organizations on purpose. The API, the workers and the tests stamp every connection before use
-- (libs/core database-context.ts); a connection with no stamp sees nothing. The owner (migrations, seeds, restores)
-- is not subject to these policies, so a deployment whose DATABASE_URL is still the owner sees no change.
--
-- Rows without an organization: shared rows (built-in roles, sessions before an organization is chosen) are visible
-- to every context; audit events without one (for example a failed sign-in with an unknown email) can always be
-- written but are visible only to the platform scope.

-- Whether the connection may see a row of this organization.
CREATE OR REPLACE FUNCTION rls_organization_visible(row_organization uuid) RETURNS boolean AS $$
  SELECT current_setting('app.scope', true) = 'all'
      OR (current_setting('app.scope', true) = 'organization'
          AND row_organization IS NOT NULL
          AND row_organization::text = current_setting('app.organization_id', true));
$$ LANGUAGE sql STABLE;

-- The audit trail (partitioned, 0110): its own rule for events without an organization.
ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON audit_event
  USING (rls_organization_visible(organization_id))
  WITH CHECK (organization_id IS NULL OR rls_organization_visible(organization_id));

-- Every other table with an organization_id (and any later one): enabled and given the same policy, shared rows
-- (organization_id null, where the column allows it) visible to all. Partitions are covered through their parent.
-- Run after every migration (libs/core migrator), like apply_app_privileges().
CREATE OR REPLACE FUNCTION apply_rls_policies() RETURNS int AS $$
DECLARE
  target record;
  created int := 0;
BEGIN
  FOR target IN
    SELECT c.relname, a.attnotnull
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'organization_isolation')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target.relname);
    IF target.attnotnull THEN
      EXECUTE format(
        'CREATE POLICY organization_isolation ON %I USING (rls_organization_visible(organization_id)) WITH CHECK (rls_organization_visible(organization_id))',
        target.relname);
    ELSE
      EXECUTE format(
        'CREATE POLICY organization_isolation ON %I USING (organization_id IS NULL OR rls_organization_visible(organization_id)) WITH CHECK (organization_id IS NULL OR rls_organization_visible(organization_id))',
        target.relname);
    END IF;
    created := created + 1;
  END LOOP;
  RETURN created;
END;
$$ LANGUAGE plpgsql;

SELECT apply_rls_policies();
