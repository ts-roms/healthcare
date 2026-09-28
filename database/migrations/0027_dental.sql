-- Dental (Phase 6). See docs/domains/dental.md and libs/dental/CLAUDE.md.
--
-- Same Patient Master: every dental record references the canonical patient. A dental visit is a clinic encounter
-- with a dentist (appointments, queue, notes, diagnoses, prescriptions and laboratory orders reuse the clinic
-- workflow); this schema adds what is specific to dentistry.
--
-- Teeth are stored in FDI / ISO 3950 two-digit notation (permanent 11–48, primary 51–85) and rendered in the
-- facility's configured notation. Surfaces use a fixed canonical set: M (mesial), D (distal), O (occlusal, posterior
-- teeth), I (incisal, anterior teeth), B (buccal / facial / labial), L (lingual / palatal); the service validates
-- tooth–surface combinations.
--
-- The chart is never edited in place: examinations and procedures append tooth states (append-only), and the current
-- chart is the latest state of each tooth whose source has not been marked entered in error.
--
-- Procedure codes are the organization's own catalog: no national dental procedure coding is assumed (a licensed
-- code set such as CDT, or a PhilHealth benefit code list, is a configuration/compliance decision).

-- ---- configuration ------------------------------------------------------------------------------------

-- How teeth are displayed at a facility. Storage is always FDI.
CREATE TABLE dental_facility_setting (
  facility_id      uuid        PRIMARY KEY,
  organization_id  uuid        NOT NULL,
  notation         text        NOT NULL DEFAULT 'fdi' CHECK (notation IN ('fdi', 'universal', 'palmer')),
  updated_by       uuid        NOT NULL REFERENCES app_user (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id)
);

-- The organization's dental procedures. `site` says what a procedure is recorded against (the whole mouth, a tooth,
-- or surfaces of a tooth); `chart_effect` is the tooth condition a performed procedure leaves on the chart.
CREATE TABLE dental_procedure_type (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  code             text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name             text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  site             text        NOT NULL CHECK (site IN ('mouth', 'tooth', 'surface')),
  chart_effect     text        CHECK (chart_effect IN ('restoration', 'sealant', 'crown', 'root_canal', 'missing', 'implant', 'pontic')),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, code),
  -- A whole-mouth procedure (e.g. oral prophylaxis) cannot change a tooth.
  CHECK (site <> 'mouth' OR chart_effect IS NULL),
  -- Surface conditions need surfaces; tooth conditions must not have them.
  CHECK (chart_effect IS NULL OR (chart_effect IN ('restoration', 'sealant')) = (site = 'surface'))
);

-- ---- corrections guard --------------------------------------------------------------------------------

-- Examinations, procedures and images are immutable once recorded; the only change is marking one entered in error
-- (with a reason), which removes it from the current chart without deleting it.
CREATE FUNCTION dental_record_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  correction CONSTANT text[] := ARRAY['status', 'entered_in_error_reason', 'entered_in_error_at', 'entered_in_error_by'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'recorded' OR NEW.status <> 'entered_in_error' OR (to_jsonb(NEW) - correction) IS DISTINCT FROM (to_jsonb(OLD) - correction) THEN
    RAISE EXCEPTION '% is immutable; mark it entered in error instead', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

-- ---- examinations -------------------------------------------------------------------------------------

CREATE TABLE dental_examination (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL,
  facility_id              uuid        NOT NULL,
  patient_id               uuid        NOT NULL,
  encounter_id             uuid        NOT NULL,
  practitioner_id          uuid        NOT NULL,
  oral_hygiene             text        CHECK (oral_hygiene IN ('good', 'fair', 'poor')),
  -- Soft tissue, occlusion, periodontal and other general findings, and the dental history taken.
  notes                    text        CHECK (length(notes) <= 4000),
  status                   text        NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'entered_in_error')),
  entered_in_error_reason  text,
  entered_in_error_at      timestamptz,
  entered_in_error_by      uuid        REFERENCES app_user (id),
  recorded_by              uuid        NOT NULL REFERENCES app_user (id),
  recorded_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (patient_id, id),
  FOREIGN KEY (organization_id, facility_id)     REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)      REFERENCES patient (organization_id, id),
  FOREIGN KEY (patient_id, encounter_id)         REFERENCES encounter (patient_id, id),
  FOREIGN KEY (organization_id, practitioner_id) REFERENCES practitioner (organization_id, id),
  CHECK ((status = 'entered_in_error') = (length(btrim(entered_in_error_reason)) >= 5 AND entered_in_error_at IS NOT NULL AND entered_in_error_by IS NOT NULL))
);
CREATE INDEX dental_examination_patient_idx ON dental_examination (organization_id, patient_id, recorded_at DESC);
CREATE TRIGGER dental_examination_immutable BEFORE UPDATE OR DELETE ON dental_examination
  FOR EACH ROW EXECUTE FUNCTION dental_record_guard();

-- ---- treatment plans ----------------------------------------------------------------------------------

CREATE TABLE dental_treatment_plan (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL,
  facility_id         uuid        NOT NULL,
  patient_id          uuid        NOT NULL,
  practitioner_id     uuid        NOT NULL,
  title               text        NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  notes               text        CHECK (length(notes) <= 2000),
  status              text        NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'in_progress', 'completed', 'declined', 'discontinued')),
  -- How the patient agreed or declined (e.g. "explained options and fees; signed consent form").
  decision_note       text        CHECK (length(decision_note) <= 1000),
  decided_at          timestamptz,
  decided_by          uuid        REFERENCES app_user (id),
  discontinued_reason text,
  created_by          uuid        NOT NULL REFERENCES app_user (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id)     REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)      REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, practitioner_id) REFERENCES practitioner (organization_id, id),
  CHECK ((status = 'proposed') = (decided_at IS NULL)),
  CHECK (decided_at IS NULL OR (decided_by IS NOT NULL AND length(btrim(decision_note)) > 0)),
  CHECK ((status = 'discontinued') = (length(btrim(discontinued_reason)) >= 5))
);
CREATE INDEX dental_treatment_plan_patient_idx ON dental_treatment_plan (organization_id, patient_id, created_at DESC);

CREATE TABLE dental_treatment_plan_item (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL,
  plan_id            uuid        NOT NULL,
  phase              smallint    NOT NULL DEFAULT 1 CHECK (phase BETWEEN 1 AND 9),
  procedure_type_id  uuid        NOT NULL,
  tooth              text        CHECK (tooth ~ '^([1-4][1-8]|[5-8][1-5])$'),
  surfaces           text[]      NOT NULL DEFAULT '{}' CHECK (surfaces <@ ARRAY['M', 'D', 'O', 'I', 'B', 'L']::text[]),
  note               text        CHECK (length(note) <= 500),
  status             text        NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'declined', 'completed', 'cancelled')),
  procedure_id       uuid,
  created_by         uuid        NOT NULL REFERENCES app_user (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, plan_id)           REFERENCES dental_treatment_plan (organization_id, id),
  FOREIGN KEY (organization_id, procedure_type_id) REFERENCES dental_procedure_type (organization_id, id),
  CHECK ((status = 'completed') = (procedure_id IS NOT NULL))
);
CREATE INDEX dental_treatment_plan_item_plan_idx ON dental_treatment_plan_item (plan_id, phase);

-- ---- procedures ---------------------------------------------------------------------------------------

CREATE TABLE dental_procedure (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL,
  facility_id              uuid        NOT NULL,
  patient_id               uuid        NOT NULL,
  encounter_id             uuid        NOT NULL,
  practitioner_id          uuid        NOT NULL,
  procedure_type_id        uuid        NOT NULL,
  tooth                    text        CHECK (tooth ~ '^([1-4][1-8]|[5-8][1-5])$'),
  surfaces                 text[]      NOT NULL DEFAULT '{}' CHECK (surfaces <@ ARRAY['M', 'D', 'O', 'I', 'B', 'L']::text[]),
  notes                    text        CHECK (length(notes) <= 2000),
  plan_item_id             uuid,
  status                   text        NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'entered_in_error')),
  entered_in_error_reason  text,
  entered_in_error_at      timestamptz,
  entered_in_error_by      uuid        REFERENCES app_user (id),
  performed_at             timestamptz NOT NULL DEFAULT now(),
  recorded_by              uuid        NOT NULL REFERENCES app_user (id),
  UNIQUE (organization_id, id),
  UNIQUE (patient_id, id),
  FOREIGN KEY (organization_id, facility_id)       REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)        REFERENCES patient (organization_id, id),
  FOREIGN KEY (patient_id, encounter_id)           REFERENCES encounter (patient_id, id),
  FOREIGN KEY (organization_id, practitioner_id)   REFERENCES practitioner (organization_id, id),
  FOREIGN KEY (organization_id, procedure_type_id) REFERENCES dental_procedure_type (organization_id, id),
  FOREIGN KEY (organization_id, plan_item_id)      REFERENCES dental_treatment_plan_item (organization_id, id),
  CHECK (tooth IS NOT NULL OR cardinality(surfaces) = 0),
  CHECK ((status = 'entered_in_error') = (length(btrim(entered_in_error_reason)) >= 5 AND entered_in_error_at IS NOT NULL AND entered_in_error_by IS NOT NULL))
);
CREATE INDEX dental_procedure_patient_idx ON dental_procedure (organization_id, patient_id, performed_at DESC);
-- A plan item is completed by one procedure at most (a correction frees it again).
CREATE UNIQUE INDEX dental_procedure_plan_item_uq ON dental_procedure (plan_item_id) WHERE plan_item_id IS NOT NULL AND status = 'recorded';
CREATE TRIGGER dental_procedure_immutable BEFORE UPDATE OR DELETE ON dental_procedure
  FOR EACH ROW EXECUTE FUNCTION dental_record_guard();

ALTER TABLE dental_treatment_plan_item
  ADD FOREIGN KEY (organization_id, procedure_id) REFERENCES dental_procedure (organization_id, id);

-- ---- chart history (append-only) ----------------------------------------------------------------------

-- The state of one tooth as charted by an examination or left by a procedure. No findings means sound.
CREATE TABLE dental_tooth_state (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  patient_id       uuid        NOT NULL,
  -- Orders states of the same tooth (later wins).
  sequence         bigint      GENERATED ALWAYS AS IDENTITY,
  tooth            text        NOT NULL CHECK (tooth ~ '^([1-4][1-8]|[5-8][1-5])$'),
  source_type      text        NOT NULL CHECK (source_type IN ('examination', 'procedure')),
  examination_id   uuid,
  procedure_id     uuid,
  note             text        CHECK (length(note) <= 500),
  recorded_by      uuid        NOT NULL REFERENCES app_user (id),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id),
  FOREIGN KEY (patient_id, examination_id)  REFERENCES dental_examination (patient_id, id),
  FOREIGN KEY (patient_id, procedure_id)    REFERENCES dental_procedure (patient_id, id),
  CHECK ((source_type = 'examination') = (examination_id IS NOT NULL AND procedure_id IS NULL)),
  CHECK ((source_type = 'procedure') = (procedure_id IS NOT NULL AND examination_id IS NULL))
);
CREATE UNIQUE INDEX dental_tooth_state_examination_uq ON dental_tooth_state (examination_id, tooth) WHERE examination_id IS NOT NULL;
CREATE UNIQUE INDEX dental_tooth_state_procedure_uq ON dental_tooth_state (procedure_id, tooth) WHERE procedure_id IS NOT NULL;
CREATE INDEX dental_tooth_state_chart_idx ON dental_tooth_state (organization_id, patient_id, tooth, sequence DESC);
CREATE TRIGGER dental_tooth_state_append_only BEFORE UPDATE OR DELETE ON dental_tooth_state
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TABLE dental_tooth_finding (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  state_id         uuid        NOT NULL,
  condition        text        NOT NULL CHECK (condition IN
                     ('caries', 'restoration', 'sealant', 'fracture', 'crown', 'root_canal', 'missing', 'implant', 'pontic',
                      'impacted', 'unerupted', 'watch')),
  surfaces         text[]      NOT NULL DEFAULT '{}' CHECK (surfaces <@ ARRAY['M', 'D', 'O', 'I', 'B', 'L']::text[]),
  FOREIGN KEY (organization_id, state_id) REFERENCES dental_tooth_state (organization_id, id),
  UNIQUE (state_id, condition)
);
CREATE TRIGGER dental_tooth_finding_append_only BEFORE UPDATE OR DELETE ON dental_tooth_finding
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- imaging ------------------------------------------------------------------------------------------

-- Radiographs and photos: the file is a document in private object storage (libs/documents); this is its dental
-- metadata. Opening one issues a short-lived signed URL (audited).
CREATE TABLE dental_image (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL,
  facility_id              uuid        NOT NULL,
  patient_id               uuid        NOT NULL,
  document_id              uuid        NOT NULL UNIQUE,
  encounter_id             uuid,
  kind                     text        NOT NULL CHECK (kind IN
                             ('periapical', 'bitewing', 'panoramic', 'cephalometric', 'occlusal', 'cbct', 'intraoral_photo',
                              'extraoral_photo', 'other')),
  teeth                    text[]      NOT NULL DEFAULT '{}'
                             CHECK (cardinality(teeth) <= 52 AND array_to_string(teeth, ',') ~ '^((([1-4][1-8]|[5-8][1-5]),)*([1-4][1-8]|[5-8][1-5]))?$'),
  taken_on                 date        NOT NULL,
  notes                    text        CHECK (length(notes) <= 1000),
  status                   text        NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'entered_in_error')),
  entered_in_error_reason  text,
  entered_in_error_at      timestamptz,
  entered_in_error_by      uuid        REFERENCES app_user (id),
  recorded_by              uuid        NOT NULL REFERENCES app_user (id),
  recorded_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)  REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, document_id) REFERENCES document (organization_id, id),
  FOREIGN KEY (patient_id, encounter_id)     REFERENCES encounter (patient_id, id),
  CHECK ((status = 'entered_in_error') = (length(btrim(entered_in_error_reason)) >= 5 AND entered_in_error_at IS NOT NULL AND entered_in_error_by IS NOT NULL))
);
CREATE INDEX dental_image_patient_idx ON dental_image (organization_id, patient_id, taken_on DESC);
CREATE TRIGGER dental_image_immutable BEFORE UPDATE OR DELETE ON dental_image
  FOR EACH ROW EXECUTE FUNCTION dental_record_guard();

-- ---- billing: dental procedures are a charge source ---------------------------------------------------

-- Billing captures a charge for a performed procedure whose code a billing service maps (source_kind
-- 'dental_procedure'); a procedure marked entered in error cancels its charge while it is not yet invoiced.
ALTER TABLE billing_service DROP CONSTRAINT billing_service_source_kind_check;
ALTER TABLE billing_service ADD CONSTRAINT billing_service_source_kind_check CHECK (source_kind IN ('visit_type', 'lab_test', 'dental_procedure'));
ALTER TABLE billing_charge DROP CONSTRAINT billing_charge_source_type_check;
ALTER TABLE billing_charge ADD CONSTRAINT billing_charge_source_type_check CHECK (source_type IN ('encounter', 'lab_order_item', 'dental_procedure', 'manual'));

-- ---- permissions and roles ----------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('dental.record.read',            'View the dental record: chart, examinations, treatment plans, procedures, image list'),
  ('dental.record.write',           'Correct the dental record: mark examinations, procedures and images entered in error'),
  ('dental.chart.write',            'Record dental examinations and chart teeth'),
  ('dental.treatment-plan.manage',  'Propose dental treatment plans and record the patient''s decision'),
  ('dental.procedure.record',       'Record performed dental procedures'),
  ('dental.imaging.read',           'Open dental radiographs and photos'),
  ('dental.imaging.upload',         'Add dental radiographs and photos'),
  ('dental.settings.manage',        'Manage the dental procedure catalog and tooth notation');

INSERT INTO role (key, name, description, is_system) VALUES
  ('dentist',          'Dentist',          'Dental examinations, charting, treatment plans, procedures, imaging; clinical access like a physician', true),
  ('dental_assistant', 'Dental assistant', 'Dental chairside support: dental record and imaging; clinical support like a nurse',              true);

-- Dentists work in the clinic workflow like physicians (appointments, queue, encounters, prescriptions, lab orders).
INSERT INTO role_permission (role_id, permission_key)
SELECT d.id, rp.permission_key FROM role d
JOIN role p ON p.key = 'physician' AND p.is_system
JOIN role_permission rp ON rp.role_id = p.id
WHERE d.key = 'dentist' AND d.is_system
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_key)
SELECT d.id, rp.permission_key FROM role d
JOIN role n ON n.key = 'nurse' AND n.is_system
JOIN role_permission rp ON rp.role_id = n.id
WHERE d.key = 'dental_assistant' AND d.is_system
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, p.key FROM role r CROSS JOIN permission p
WHERE r.is_system AND p.key LIKE 'dental.%'
  AND (r.key = 'org_admin' OR (r.key = 'dentist' AND p.key <> 'dental.settings.manage'))
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('dental_assistant', 'dental.record.read'), ('dental_assistant', 'dental.imaging.read'), ('dental_assistant', 'dental.imaging.upload'),
  ('physician', 'dental.record.read'), ('nurse', 'dental.record.read')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system
ON CONFLICT DO NOTHING;
