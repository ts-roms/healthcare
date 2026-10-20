-- Visit routes (docs/domains/clinic.md, "Visit routes"; ADR-0014 follow-up).
--
-- After triage a patient often has more than one stop ahead — the laboratory, then X-ray, then back to the doctor. A
-- route is the planned sequence of service points for one visit. Finishing the step at the current service point
-- (a person's click) moves the visit to the next planned one through the ordinary routing history and, when the
-- facility wants it, calls the patient there so the waiting-room display announces it. Nothing clinical moves a
-- patient on its own: a specimen collected or a procedure recorded completes no step (a documented follow-up).

-- What the waiting-room display says when a route sends a patient to the service point ("Laboratory, 2nd floor");
-- the service point's name when unset. Short, because it is spoken and shown in large type.
ALTER TABLE service_point ADD COLUMN location text CHECK (location IS NULL OR length(btrim(location)) BETWEEN 1 AND 60);

-- Per-facility routing settings; a facility without a row keeps the defaults (nothing called automatically).
CREATE TABLE service_point_setting (
  facility_id         uuid        PRIMARY KEY REFERENCES facility (id),
  organization_id     uuid        NOT NULL,
  -- When a route sends the patient on, call them to the next service point's location at once (called_at / called_to
  -- on the visit, as if staff had typed it), so the waiting-room display shows and announces it.
  auto_call_on_route  boolean     NOT NULL DEFAULT false,
  updated_by          uuid        NOT NULL REFERENCES app_user (id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id)
);

-- One row per planned stop of a visit. Planning appends rows; a step moves planned → current → done, is skipped with
-- a reason, or is removed from the plan before it is reached (never while current or after). The planning itself —
-- which service point, in which position, by whom — is never rewritten.
CREATE TABLE visit_route_step (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  facility_id       uuid        NOT NULL,
  visit_id          uuid        NOT NULL,
  patient_id        uuid        NOT NULL,
  position          integer     NOT NULL CHECK (position > 0),
  service_point_id  uuid        NOT NULL,
  status            text        NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'current', 'done', 'skipped', 'removed')),
  planned_by        uuid        NOT NULL REFERENCES app_user (id),
  planned_at        timestamptz NOT NULL DEFAULT now(),
  -- When the visit arrived at the step's service point.
  started_at        timestamptz,
  -- When the step was marked done, skipped or removed, and by whom.
  completed_at      timestamptz,
  completed_by      uuid        REFERENCES app_user (id),
  -- The note left at "done here", or the reason for skipping (required then).
  note              text        CHECK (note IS NULL OR length(btrim(note)) > 0),
  FOREIGN KEY (organization_id, visit_id)            REFERENCES visit (organization_id, id),
  FOREIGN KEY (patient_id, visit_id)                 REFERENCES visit (patient_id, id),
  FOREIGN KEY (facility_id, service_point_id)        REFERENCES service_point (facility_id, id),
  CHECK ((status IN ('done', 'skipped', 'removed')) = (completed_at IS NOT NULL AND completed_by IS NOT NULL)),
  CHECK (status <> 'skipped' OR note IS NOT NULL),
  CHECK (status NOT IN ('current', 'done') OR started_at IS NOT NULL)
);
CREATE INDEX visit_route_step_visit_idx ON visit_route_step (visit_id, position);
-- Positions are unique among the steps still in the plan; a removed step frees its position for a re-plan.
CREATE UNIQUE INDEX visit_route_step_position_uq ON visit_route_step (visit_id, position) WHERE status <> 'removed';
-- A visit is at one step at a time.
CREATE UNIQUE INDEX visit_route_step_current_uq ON visit_route_step (visit_id) WHERE status = 'current';

-- Append-only in what was planned; only the step's progress changes, forward, and never once it is final.
CREATE FUNCTION visit_route_step_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable constant text[] := ARRAY['status', 'started_at', 'completed_at', 'completed_by', 'note'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'visit_route_step is append-only; DELETE is not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable)
     OR OLD.status IN ('done', 'skipped', 'removed')
     OR (OLD.status = 'planned' AND NEW.status NOT IN ('current', 'skipped', 'removed'))
     OR (OLD.status = 'current' AND NEW.status NOT IN ('done', 'skipped')) THEN
    RAISE EXCEPTION 'visit_route_step is append-only; only a step''s progress moves forward' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER visit_route_step_guard BEFORE UPDATE OR DELETE ON visit_route_step
  FOR EACH ROW EXECUTE FUNCTION visit_route_step_guard();
CREATE TRIGGER visit_route_step_no_truncate BEFORE TRUNCATE ON visit_route_step
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();
