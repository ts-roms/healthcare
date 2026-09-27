-- Append-only audit trail (CLAUDE.md §22).
-- Intentionally no foreign keys: the audit log must never block, and must
-- outlive, the records it describes.
CREATE TABLE audit_event (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  organization_id  uuid,
  facility_id      uuid,
  actor_type       text        NOT NULL CHECK (actor_type IN ('user', 'patient', 'system', 'anonymous')),
  actor_user_id    uuid,
  action           text        NOT NULL CHECK (action ~ '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$'),
  resource_type    text        NOT NULL,
  resource_id      text,
  patient_id       uuid,
  outcome          text        NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
  reason           text,
  changes          jsonb,
  metadata         jsonb,
  request_id       text,
  ip_address       text,
  user_agent       text,
  CHECK (actor_type NOT IN ('user', 'patient') OR actor_user_id IS NOT NULL)
);
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
