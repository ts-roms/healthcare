-- Laboratory quality management, first part (Phase 9). See docs/domains/laboratory-quality.md.
--
-- Instruments (the equipment register) with an append-only maintenance and calibration log; internal quality control
-- (control materials, their lots, target mean/SD per test and instrument, QC runs evaluated with the facility's chosen
-- Westgard rules, corrective actions); and results that record the instrument and the QC run in force when they were
-- entered. No regulatory rule is encoded: which rules reject a run, how long a run covers patient results and whether
-- patient results need accepted QC are facility configuration.

-- ---- Instruments --------------------------------------------------------------------------------

CREATE TABLE lab_instrument (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES organization (id),
  facility_id       uuid        NOT NULL,
  department_id     uuid,
  code              text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name              text        NOT NULL CHECK (length(btrim(name)) > 0),
  manufacturer      text,
  model             text,
  serial_number     text,
  -- out_of_service: not used for QC or patient results until returned to service; retired: permanently.
  status            text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'out_of_service', 'retired')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL REFERENCES app_user (id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (facility_id, code),
  FOREIGN KEY (organization_id, facility_id)   REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, department_id) REFERENCES lab_department (organization_id, id)
);

-- Maintenance, calibration, repair and verification, and service status changes. Append-only.
CREATE TABLE lab_instrument_event (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  instrument_id    uuid        NOT NULL,
  kind             text        NOT NULL CHECK (kind IN ('maintenance', 'calibration', 'repair', 'verification', 'out_of_service', 'returned_to_service', 'retired')),
  outcome          text        CHECK (outcome IN ('pass', 'fail')),
  performed_at     timestamptz NOT NULL,
  -- When this kind of work is next due (e.g. the next calibration), as the laboratory schedules it.
  next_due_on      date,
  notes            text        CHECK (length(notes) <= 2000),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  recorded_by      uuid        NOT NULL REFERENCES app_user (id),
  FOREIGN KEY (organization_id, instrument_id) REFERENCES lab_instrument (organization_id, id),
  CHECK (kind NOT IN ('calibration', 'verification') OR outcome IS NOT NULL),
  CHECK (kind NOT IN ('out_of_service', 'retired', 'repair') OR length(btrim(notes)) > 0)
);
CREATE INDEX lab_instrument_event_instrument_idx ON lab_instrument_event (instrument_id, performed_at DESC);
CREATE TRIGGER lab_instrument_event_append_only BEFORE UPDATE OR DELETE ON lab_instrument_event
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- Quality control ----------------------------------------------------------------------------

CREATE TABLE lab_qc_material (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  code             text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name             text        NOT NULL CHECK (length(btrim(name)) > 0),
  -- As the manufacturer names it, e.g. "Level 1", "Normal", "Abnormal high".
  level            text        NOT NULL CHECK (length(btrim(level)) > 0),
  manufacturer     text,
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, code)
);

CREATE TABLE lab_qc_lot (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  material_id      uuid        NOT NULL,
  lot_number       text        NOT NULL CHECK (length(btrim(lot_number)) > 0),
  expires_on       date        NOT NULL,
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (material_id, lot_number),
  FOREIGN KEY (organization_id, material_id) REFERENCES lab_qc_material (organization_id, id)
);

-- Target mean and SD of a control lot for a test on an instrument (the laboratory's own or the manufacturer's).
-- Versioned: a new target for the same lot, test and instrument closes the current one; nothing is rewritten.
CREATE TABLE lab_qc_target (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  qc_lot_id        uuid        NOT NULL,
  test_id          uuid        NOT NULL,
  instrument_id    uuid        NOT NULL,
  mean             numeric     NOT NULL,
  sd               numeric     NOT NULL CHECK (sd > 0),
  source           text        CHECK (length(source) <= 200),
  effective_from   timestamptz NOT NULL DEFAULT now(),
  effective_to     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, qc_lot_id)     REFERENCES lab_qc_lot (organization_id, id),
  FOREIGN KEY (organization_id, test_id)       REFERENCES lab_test (organization_id, id),
  FOREIGN KEY (organization_id, instrument_id) REFERENCES lab_instrument (organization_id, id),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE UNIQUE INDEX lab_qc_target_current ON lab_qc_target (qc_lot_id, test_id, instrument_id) WHERE effective_to IS NULL;

CREATE FUNCTION lab_qc_target_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'QC targets are not deleted' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF OLD.effective_to IS NOT NULL OR (NEW.mean, NEW.sd, NEW.qc_lot_id, NEW.test_id, NEW.instrument_id, NEW.effective_from, NEW.source)
     IS DISTINCT FROM (OLD.mean, OLD.sd, OLD.qc_lot_id, OLD.test_id, OLD.instrument_id, OLD.effective_from, OLD.source) THEN
    RAISE EXCEPTION 'QC targets are immutable; add a new target instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_qc_target_immutable BEFORE UPDATE OR DELETE ON lab_qc_target
  FOR EACH ROW EXECUTE FUNCTION lab_qc_target_guard();

-- One measurement of a control: the target it was read against is snapshotted with the evaluation. Append-only.
CREATE TABLE lab_qc_run (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  facility_id      uuid        NOT NULL,
  instrument_id    uuid        NOT NULL,
  test_id          uuid        NOT NULL,
  qc_lot_id        uuid        NOT NULL,
  target_id        uuid        NOT NULL,
  value            numeric     NOT NULL,
  target_mean      numeric     NOT NULL,
  target_sd        numeric     NOT NULL CHECK (target_sd > 0),
  z_score          numeric     NOT NULL,
  status           text        NOT NULL CHECK (status IN ('accepted', 'warning', 'rejected')),
  -- Rules that fired, e.g. {1_2s} (warning) or {1_3s,2_2s} (rejection).
  violations       text[]      NOT NULL DEFAULT '{}',
  comment          text        CHECK (length(comment) <= 1000),
  run_at           timestamptz NOT NULL,
  entered_at       timestamptz NOT NULL DEFAULT now(),
  entered_by       uuid        NOT NULL REFERENCES app_user (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id)   REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, instrument_id) REFERENCES lab_instrument (organization_id, id),
  FOREIGN KEY (organization_id, test_id)       REFERENCES lab_test (organization_id, id),
  FOREIGN KEY (organization_id, qc_lot_id)     REFERENCES lab_qc_lot (organization_id, id),
  FOREIGN KEY (organization_id, target_id)     REFERENCES lab_qc_target (organization_id, id),
  CHECK ((status = 'accepted') = (cardinality(violations) = 0))
);
CREATE INDEX lab_qc_run_series_idx ON lab_qc_run (instrument_id, test_id, qc_lot_id, run_at DESC);
CREATE INDEX lab_qc_run_recent_idx ON lab_qc_run (instrument_id, test_id, run_at DESC);
CREATE TRIGGER lab_qc_run_append_only BEFORE UPDATE OR DELETE ON lab_qc_run
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- What was done about a rejected (or warning) run: cause, action, outcome. Append-only.
CREATE TABLE lab_qc_action (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  qc_run_id        uuid        NOT NULL,
  action           text        NOT NULL CHECK (length(btrim(action)) BETWEEN 3 AND 2000),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  recorded_by      uuid        NOT NULL REFERENCES app_user (id),
  FOREIGN KEY (organization_id, qc_run_id) REFERENCES lab_qc_run (organization_id, id)
);
CREATE INDEX lab_qc_action_run_idx ON lab_qc_action (qc_run_id, recorded_at);
CREATE TRIGGER lab_qc_action_append_only BEFORE UPDATE OR DELETE ON lab_qc_action
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- Facility QC policy -------------------------------------------------------------------------

ALTER TABLE lab_facility_policy
  -- Rules that reject a run (1_2s is always a warning). Defaults to the common 1_3s / 2_2s / R_4s set.
  ADD COLUMN qc_reject_rules   text[]  NOT NULL DEFAULT '{1_3s,2_2s,R_4s}'
    CHECK (qc_reject_rules <@ ARRAY['1_3s', '2_2s', 'R_4s', '4_1s', '10_x']::text[]),
  -- How long a QC run covers patient results on its instrument and test.
  ADD COLUMN qc_valid_hours    integer NOT NULL DEFAULT 24 CHECK (qc_valid_hours BETWEEN 1 AND 168),
  -- When true, a result entered on an instrument needs QC for the test within qc_valid_hours whose latest run is not rejected.
  ADD COLUMN qc_required       boolean NOT NULL DEFAULT false;

-- ---- Results: instrument and QC in force at entry -----------------------------------------------

ALTER TABLE lab_result
  ADD COLUMN instrument_id uuid,
  ADD COLUMN qc_run_id     uuid,
  -- The QC state when the result was entered (a snapshot, like the reference range): none = no QC run covered it.
  ADD COLUMN qc_status     text CHECK (qc_status IN ('accepted', 'warning', 'rejected', 'none')),
  ADD FOREIGN KEY (organization_id, instrument_id) REFERENCES lab_instrument (organization_id, id),
  ADD FOREIGN KEY (organization_id, qc_run_id)     REFERENCES lab_qc_run (organization_id, id),
  ADD CHECK ((instrument_id IS NULL) = (qc_status IS NULL)),
  ADD CHECK (qc_run_id IS NULL OR instrument_id IS NOT NULL);

-- The result guard (0015) keeps its rules; the instrument and QC link are immutable like the value.
CREATE OR REPLACE FUNCTION lab_result_quality_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.instrument_id, NEW.qc_run_id, NEW.qc_status) IS DISTINCT FROM (OLD.instrument_id, OLD.qc_run_id, OLD.qc_status) THEN
    RAISE EXCEPTION 'laboratory result values are immutable; enter a corrected version instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_result_quality_immutable BEFORE UPDATE ON lab_result
  FOR EACH ROW EXECUTE FUNCTION lab_result_quality_guard();

-- ---- Permissions --------------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('lab.qc.read',           'View laboratory quality control, instruments and their logs'),
  ('lab.qc.enter',          'Enter QC runs, corrective actions and instrument maintenance and calibration'),
  ('lab.qc.manage',         'Manage QC materials, lots and targets, and instruments');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('org_admin', 'lab.qc.read'), ('org_admin', 'lab.qc.enter'), ('org_admin', 'lab.qc.manage'),
  ('medical_technologist', 'lab.qc.read'), ('medical_technologist', 'lab.qc.enter'),
  ('pathologist', 'lab.qc.read'), ('pathologist', 'lab.qc.enter'), ('pathologist', 'lab.qc.manage')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system
ON CONFLICT DO NOTHING;
