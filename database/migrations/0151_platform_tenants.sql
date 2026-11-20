-- Platform console: tenants (docs/architecture/platform-console.md).
--
-- Platform administrators see every organization on the platform (operational figures only, never a patient's data),
-- create a tenant with its first facility and administrator, and suspend or reactivate one with a reason. A suspended
-- organization's staff and MyHealth patients cannot sign in or use the API (organization.status, already checked at
-- sign-in and now on every request), and their sessions end at the suspension. Each change of status is kept here,
-- append-only, beside the audit event.

CREATE TABLE organization_status_change (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  from_status      text        NOT NULL CHECK (from_status IN ('active', 'suspended', 'archived')),
  to_status        text        NOT NULL CHECK (to_status IN ('active', 'suspended', 'archived')),
  reason           text        NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 1000),
  changed_by       uuid        NOT NULL REFERENCES app_user (id),
  changed_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (from_status <> to_status)
);

CREATE INDEX organization_status_change_recent ON organization_status_change (organization_id, changed_at DESC);

CREATE TRIGGER organization_status_change_append_only
  BEFORE UPDATE OR DELETE ON organization_status_change
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER organization_status_change_no_truncate
  BEFORE TRUNCATE ON organization_status_change
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();

-- The console's last staff sign-in per organization.
CREATE INDEX IF NOT EXISTS auth_session_organization_recent ON auth_session (organization_id, created_at DESC);
