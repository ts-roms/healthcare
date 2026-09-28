-- Laboratory quality management, second part (Phase 9). See docs/domains/laboratory-quality.md.
--
-- Temperature monitoring of storage units, nonconformance (incidents) with corrective and preventive action, external
-- quality assessment (proficiency testing) and staff competency. No regulatory rule is encoded: acceptable temperature
-- ranges and reading intervals, EQA providers and their grading, and competency areas and intervals are the laboratory's
-- own configuration, recorded as given.

-- ---- Temperature monitoring -----------------------------------------------------------------------

CREATE TABLE lab_storage_unit (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid        NOT NULL REFERENCES organization (id),
  facility_id             uuid        NOT NULL,
  department_id           uuid,
  code                    text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name                    text        NOT NULL CHECK (length(btrim(name)) > 0),
  kind                    text        NOT NULL CHECK (kind IN ('refrigerator', 'freezer', 'incubator', 'water_bath', 'room', 'other')),
  -- The acceptable range the laboratory set for this unit (°C).
  min_celsius             numeric     NOT NULL,
  max_celsius             numeric     NOT NULL,
  -- How often a reading is expected (hours); null: no schedule.
  reading_interval_hours  integer     CHECK (reading_interval_hours BETWEEN 1 AND 168),
  status                  text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid        NOT NULL REFERENCES app_user (id),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  version                 integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (facility_id, code),
  FOREIGN KEY (organization_id, facility_id)   REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, department_id) REFERENCES lab_department (organization_id, id),
  CHECK (max_celsius > min_celsius)
);

-- One reading, with the range it was read against (snapshot). Append-only.
CREATE TABLE lab_temperature_reading (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  storage_unit_id  uuid        NOT NULL,
  celsius          numeric     NOT NULL CHECK (celsius BETWEEN -273.15 AND 1000),
  min_celsius      numeric     NOT NULL,
  max_celsius      numeric     NOT NULL,
  out_of_range     boolean     NOT NULL,
  read_at          timestamptz NOT NULL,
  note             text        CHECK (length(note) <= 1000),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  recorded_by      uuid        NOT NULL REFERENCES app_user (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, storage_unit_id) REFERENCES lab_storage_unit (organization_id, id),
  CHECK (out_of_range = (celsius < min_celsius OR celsius > max_celsius)),
  -- An excursion is explained when it is recorded (what was seen, what was done immediately).
  CHECK (NOT out_of_range OR length(btrim(note)) > 0)
);
CREATE INDEX lab_temperature_reading_unit_idx ON lab_temperature_reading (storage_unit_id, read_at DESC);
CREATE TRIGGER lab_temperature_reading_append_only BEFORE UPDATE OR DELETE ON lab_temperature_reading
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- Nonconformance and corrective action ---------------------------------------------------------

CREATE TABLE lab_nonconformance_number_sequence (
  organization_id  uuid   PRIMARY KEY REFERENCES organization (id),
  next_value       bigint NOT NULL
);

CREATE TABLE lab_nonconformance (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid        NOT NULL REFERENCES organization (id),
  facility_id             uuid        NOT NULL,
  number                  text        NOT NULL,
  category                text        NOT NULL CHECK (category IN ('pre_analytical', 'analytical', 'post_analytical', 'equipment', 'temperature_excursion',
                                        'qc_failure', 'eqa_failure', 'safety', 'complaint', 'other')),
  severity                text        NOT NULL CHECK (severity IN ('minor', 'major', 'critical')),
  title                   text        NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  description             text        NOT NULL CHECK (length(btrim(description)) BETWEEN 3 AND 4000),
  occurred_at             timestamptz NOT NULL,
  -- What it concerns (optional). A specimen links the patient; the record itself holds no patient identifiers.
  instrument_id           uuid,
  qc_run_id               uuid,
  temperature_reading_id  uuid,
  eqa_result_id           uuid,
  specimen_id             uuid,
  status                  text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'closed')),
  reported_at             timestamptz NOT NULL DEFAULT now(),
  -- Null when the platform opened it (temperature excursion, unacceptable EQA result).
  reported_by             uuid        REFERENCES app_user (id),
  closed_at               timestamptz,
  closed_by               uuid        REFERENCES app_user (id),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  version                 integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, number),
  FOREIGN KEY (organization_id, facility_id)            REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, instrument_id)          REFERENCES lab_instrument (organization_id, id),
  FOREIGN KEY (organization_id, qc_run_id)              REFERENCES lab_qc_run (organization_id, id),
  FOREIGN KEY (organization_id, temperature_reading_id) REFERENCES lab_temperature_reading (organization_id, id),
  FOREIGN KEY (organization_id, specimen_id)            REFERENCES lab_specimen (organization_id, id),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL AND closed_by IS NOT NULL))
);
CREATE INDEX lab_nonconformance_facility_idx ON lab_nonconformance (facility_id, status, reported_at DESC);
-- One nonconformance per excursion and per unacceptable EQA result (opened by the platform, idempotently).
CREATE UNIQUE INDEX lab_nonconformance_reading ON lab_nonconformance (temperature_reading_id) WHERE temperature_reading_id IS NOT NULL;
CREATE UNIQUE INDEX lab_nonconformance_eqa ON lab_nonconformance (eqa_result_id) WHERE eqa_result_id IS NOT NULL;

-- A closed nonconformance is final; its facts never change; nothing is deleted.
CREATE FUNCTION lab_nonconformance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'nonconformances are not deleted' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF OLD.status = 'closed' THEN RAISE EXCEPTION 'a closed nonconformance cannot change' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF (NEW.organization_id, NEW.facility_id, NEW.number, NEW.occurred_at, NEW.reported_at, NEW.reported_by, NEW.instrument_id, NEW.qc_run_id,
      NEW.temperature_reading_id, NEW.eqa_result_id, NEW.specimen_id)
     IS DISTINCT FROM
     (OLD.organization_id, OLD.facility_id, OLD.number, OLD.occurred_at, OLD.reported_at, OLD.reported_by, OLD.instrument_id, OLD.qc_run_id,
      OLD.temperature_reading_id, OLD.eqa_result_id, OLD.specimen_id) THEN
    RAISE EXCEPTION 'what a nonconformance concerns and when it was reported cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_nonconformance_history BEFORE UPDATE OR DELETE ON lab_nonconformance
  FOR EACH ROW EXECUTE FUNCTION lab_nonconformance_guard();

-- The investigation trail: notes, correction, root cause, corrective and preventive action, effectiveness check,
-- classification changes and closing. Append-only.
CREATE TABLE lab_nonconformance_entry (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL,
  nonconformance_id   uuid        NOT NULL,
  kind                text        NOT NULL CHECK (kind IN ('note', 'correction', 'root_cause', 'corrective_action', 'preventive_action',
                                    'effectiveness_check', 'reclassified', 'closed')),
  body                text        NOT NULL CHECK (length(btrim(body)) BETWEEN 3 AND 4000),
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  recorded_by         uuid        NOT NULL REFERENCES app_user (id),
  FOREIGN KEY (organization_id, nonconformance_id) REFERENCES lab_nonconformance (organization_id, id)
);
CREATE INDEX lab_nonconformance_entry_idx ON lab_nonconformance_entry (nonconformance_id, recorded_at);
CREATE TRIGGER lab_nonconformance_entry_append_only BEFORE UPDATE OR DELETE ON lab_nonconformance_entry
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- External quality assessment (proficiency testing) --------------------------------------------

CREATE TABLE lab_eqa_scheme (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  code             text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  -- As the provider names itself and the programme; not verified by the platform.
  provider         text        NOT NULL CHECK (length(btrim(provider)) > 0),
  name             text        NOT NULL CHECK (length(btrim(name)) > 0),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, code)
);

-- One round (shipment) of a scheme at a facility.
CREATE TABLE lab_eqa_survey (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  facility_id      uuid        NOT NULL,
  scheme_id        uuid        NOT NULL,
  round_code       text        NOT NULL CHECK (length(btrim(round_code)) BETWEEN 1 AND 60),
  received_on      date        NOT NULL,
  due_on           date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  UNIQUE (organization_id, id),
  UNIQUE (facility_id, scheme_id, round_code),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, scheme_id)   REFERENCES lab_eqa_scheme (organization_id, id)
);

-- A result reported for one sample and test of a round, and — later, once — the provider's evaluation of it.
CREATE TABLE lab_eqa_result (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL,
  survey_id          uuid        NOT NULL,
  test_id            uuid        NOT NULL,
  sample_code        text        NOT NULL CHECK (length(btrim(sample_code)) BETWEEN 1 AND 60),
  reported_value     text        NOT NULL CHECK (length(btrim(reported_value)) BETWEEN 1 AND 200),
  reported_at        timestamptz NOT NULL DEFAULT now(),
  reported_by        uuid        NOT NULL REFERENCES app_user (id),
  -- The provider's evaluation, as the provider gave it.
  evaluation         text        CHECK (evaluation IN ('acceptable', 'unacceptable', 'not_graded')),
  target_value       text        CHECK (length(target_value) <= 200),
  provider_score     text        CHECK (length(provider_score) <= 60),
  evaluation_note    text        CHECK (length(evaluation_note) <= 1000),
  evaluated_at       timestamptz,
  evaluated_by       uuid        REFERENCES app_user (id),
  UNIQUE (organization_id, id),
  UNIQUE (survey_id, sample_code, test_id),
  FOREIGN KEY (organization_id, survey_id) REFERENCES lab_eqa_survey (organization_id, id),
  FOREIGN KEY (organization_id, test_id)   REFERENCES lab_test (organization_id, id),
  CHECK ((evaluation IS NULL) = (evaluated_at IS NULL) AND (evaluated_at IS NULL) = (evaluated_by IS NULL))
);

-- Reported values never change; the evaluation is recorded once.
CREATE FUNCTION lab_eqa_result_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'EQA results are not deleted' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF OLD.evaluated_at IS NOT NULL
     OR (NEW.organization_id, NEW.survey_id, NEW.test_id, NEW.sample_code, NEW.reported_value, NEW.reported_at, NEW.reported_by)
        IS DISTINCT FROM (OLD.organization_id, OLD.survey_id, OLD.test_id, OLD.sample_code, OLD.reported_value, OLD.reported_at, OLD.reported_by) THEN
    RAISE EXCEPTION 'an EQA result is reported once and evaluated once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_eqa_result_history BEFORE UPDATE OR DELETE ON lab_eqa_result
  FOR EACH ROW EXECUTE FUNCTION lab_eqa_result_guard();

ALTER TABLE lab_nonconformance ADD FOREIGN KEY (organization_id, eqa_result_id) REFERENCES lab_eqa_result (organization_id, id);

-- ---- Staff competency ---------------------------------------------------------------------------------

-- An assessment of a staff member for a test or a whole department (section). Append-only; the latest counts.
CREATE TABLE lab_competency_assessment (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  facility_id      uuid        NOT NULL,
  user_id          uuid        NOT NULL REFERENCES app_user (id),
  test_id          uuid,
  department_id    uuid,
  method           text        NOT NULL CHECK (method IN ('direct_observation', 'blind_sample', 'record_review', 'written_assessment', 'other')),
  outcome          text        NOT NULL CHECK (outcome IN ('competent', 'not_yet_competent')),
  assessed_on      date        NOT NULL,
  next_due_on      date,
  notes            text        CHECK (length(notes) <= 2000),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  assessed_by      uuid        NOT NULL REFERENCES app_user (id),
  FOREIGN KEY (organization_id, facility_id)   REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, test_id)       REFERENCES lab_test (organization_id, id),
  FOREIGN KEY (organization_id, department_id) REFERENCES lab_department (organization_id, id),
  -- Exactly one area: a test or a department.
  CHECK ((test_id IS NULL) <> (department_id IS NULL)),
  CHECK (next_due_on IS NULL OR next_due_on > assessed_on),
  CHECK (outcome = 'competent' OR length(btrim(notes)) > 0)
);
CREATE INDEX lab_competency_user_idx ON lab_competency_assessment (facility_id, user_id, assessed_on DESC);
CREATE TRIGGER lab_competency_assessment_append_only BEFORE UPDATE OR DELETE ON lab_competency_assessment
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- When true, a result is entered only by staff with a current "competent" assessment for the test or its department.
ALTER TABLE lab_facility_policy ADD COLUMN competency_required boolean NOT NULL DEFAULT false;
