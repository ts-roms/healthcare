-- Service points (docs/domains/clinic.md, "Service points"; ADR-0014).
--
-- An outpatient department is not one line: after triage a patient goes to the consultation line, the emergency room,
-- X-ray or another station. The organization defines its own service points per facility; a visit is at most at one
-- of them and moves between them through an append-only routing history. A null service point keeps its old meaning —
-- the facility's single consultation line — so every earlier visit and screen keeps working. Nothing national is
-- assumed: no triage scale, no emergency-care rule, no list of stations.

CREATE TABLE service_point (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  facility_id      uuid        NOT NULL,
  code             text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{0,48}$'),
  name             text        NOT NULL CHECK (length(btrim(name)) > 0),
  -- How the staff app labels and orders the service point; nothing else hangs on it.
  kind             text        NOT NULL CHECK (kind IN ('consultation', 'emergency', 'imaging', 'other')),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  UNIQUE (facility_id, code),
  UNIQUE (organization_id, id),
  UNIQUE (facility_id, id)
);

-- Where the visit is now; null = the facility's consultation line (every visit before this migration).
ALTER TABLE visit ADD COLUMN service_point_id uuid;
ALTER TABLE visit ADD CONSTRAINT visit_service_point_fk FOREIGN KEY (facility_id, service_point_id) REFERENCES service_point (facility_id, id);
CREATE INDEX visit_service_point_idx ON visit (service_point_id, queue_date) WHERE service_point_id IS NOT NULL;

-- One row per move between service points; the visit's past is never rewritten.
CREATE TABLE visit_routing (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid        NOT NULL,
  facility_id            uuid        NOT NULL,
  visit_id               uuid        NOT NULL,
  patient_id             uuid        NOT NULL,
  from_service_point_id  uuid,
  to_service_point_id    uuid        NOT NULL,
  routed_by              uuid        NOT NULL REFERENCES app_user (id),
  reason                 text        CHECK (reason IS NULL OR length(btrim(reason)) > 0),
  routed_at              timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, visit_id)             REFERENCES visit (organization_id, id),
  FOREIGN KEY (patient_id, visit_id)                  REFERENCES visit (patient_id, id),
  FOREIGN KEY (facility_id, from_service_point_id)    REFERENCES service_point (facility_id, id),
  FOREIGN KEY (facility_id, to_service_point_id)      REFERENCES service_point (facility_id, id),
  CHECK (from_service_point_id IS DISTINCT FROM to_service_point_id)
);
CREATE INDEX visit_routing_visit_idx ON visit_routing (visit_id, routed_at);
CREATE TRIGGER visit_routing_append_only BEFORE UPDATE OR DELETE ON visit_routing
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
