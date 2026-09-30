-- Patient history: past procedures, past conditions (diagnosed elsewhere), family history and social history
-- (docs/domains/patient-history.md).
--
-- What the patient, a relative or another provider reports — or a clinician documents here — about the patient's past
-- and background. Nothing here is a diagnosis, a procedure performed by the organization, a risk score or a clinical
-- rule: past conditions are never the problem list (diagnoses recorded in consultations), never billed and never
-- matched by DOH reporting rules. No national code set is assumed: an optional code is kept under a code-system key the
-- organization names (or the system URI as received for an import).
--
-- Every row is immutable except being marked entered in error (once, with a reason); a correction is a mistake marked
-- entered in error and a new entry. Family history reviews are append-only (a later review supersedes). Social history
-- is a chain of versions: each version is a whole snapshot, the current one is the latest recorded that is not in error.
-- Substance use and sexual history are sensitive: the API shows them only to users who also hold encounter.write.

-- ---- permissions --------------------------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('history.read',   'View a patient''s past procedures and conditions, family and social history (substance use and sexual history also need encounter.write)'),
  ('history.record', 'Record past procedures and conditions, family history and its review, new social history versions, and mark entries entered in error');

-- Clinicians record the history (dentists take a medical history too); the records office reads it.
INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('org_admin', 'history.read'), ('org_admin', 'history.record'),
  ('physician', 'history.read'), ('physician', 'history.record'),
  ('nurse', 'history.read'), ('nurse', 'history.record'),
  ('dentist', 'history.read'), ('dentist', 'history.record'),
  ('records_officer', 'history.read')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system
ON CONFLICT DO NOTHING;

-- ---- past procedures ----------------------------------------------------------------------------------------

CREATE TABLE past_procedure (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid        NOT NULL,
  patient_id                uuid        NOT NULL,
  -- The consultation in which the history was taken (optional).
  encounter_id              uuid,
  -- The procedure as written (e.g. "Appendectomy"); an optional code of a code system the organization names (a key),
  -- or the system URI as received for an import.
  description               text        NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 300),
  code_system               text        CHECK (length(code_system) BETWEEN 1 AND 200),
  code                      text        CHECK (length(btrim(code)) BETWEEN 1 AND 60),
  -- When it was done, as precise as known: a year (kept as 1 January), a month (its first day) or a day; unknown: null.
  performed_date            date,
  performed_precision       text        CHECK (performed_precision IN ('year', 'month', 'day')),
  -- Where and by whom, as reported (e.g. "Philippine General Hospital, Dr. Santos").
  performer                 text        CHECK (length(btrim(performer)) BETWEEN 1 AND 300),
  -- Laterality or body site, as written (e.g. "left knee").
  body_site                 text        CHECK (length(btrim(body_site)) BETWEEN 1 AND 120),
  notes                     text        CHECK (length(btrim(notes)) BETWEEN 1 AND 2000),
  -- reported: told by the patient, a relative or another provider; recorded_here: documented by a clinician of the
  -- organization (e.g. from the records the patient brought); external_import: accepted from a FHIR import.
  source                    text        NOT NULL CHECK (source IN ('reported', 'recorded_here', 'external_import')),
  reported_by               text        CHECK (reported_by IN ('patient', 'relative', 'other_provider')),
  source_description        text        CHECK (length(btrim(source_description)) BETWEEN 1 AND 300),
  source_reference          text        CHECK (length(source_reference) BETWEEN 1 AND 300),
  declared_source           text        CHECK (length(declared_source) BETWEEN 1 AND 200),
  recorder_practitioner_id  uuid,
  entered_in_error_reason   text        CHECK (length(btrim(entered_in_error_reason)) BETWEEN 3 AND 500),
  entered_in_error_by       uuid        REFERENCES app_user (id),
  entered_in_error_at       timestamptz,
  recorded_by               uuid        NOT NULL REFERENCES app_user (id),
  recorded_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)               REFERENCES patient (organization_id, id),
  FOREIGN KEY (patient_id, encounter_id)                  REFERENCES encounter (patient_id, id),
  FOREIGN KEY (organization_id, recorder_practitioner_id) REFERENCES practitioner (organization_id, id),
  CHECK ((performed_date IS NULL) = (performed_precision IS NULL)),
  CHECK (performed_precision IS DISTINCT FROM 'year' OR (extract(month FROM performed_date) = 1 AND extract(day FROM performed_date) = 1)),
  CHECK (performed_precision IS DISTINCT FROM 'month' OR extract(day FROM performed_date) = 1),
  CHECK ((code IS NULL) = (code_system IS NULL)),
  CHECK ((source = 'reported') = (reported_by IS NOT NULL)),
  CHECK ((source = 'external_import') = (source_reference IS NOT NULL)),
  CHECK (source <> 'external_import' OR encounter_id IS NULL),
  CHECK ((entered_in_error_at IS NULL) = (entered_in_error_by IS NULL) AND (entered_in_error_at IS NULL) = (entered_in_error_reason IS NULL))
);
CREATE INDEX past_procedure_patient_idx ON past_procedure (organization_id, patient_id, recorded_at DESC);

-- ---- past conditions (diagnosed elsewhere; never the problem list) ----------------------------------------------

CREATE TABLE past_condition (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid        NOT NULL,
  patient_id                uuid        NOT NULL,
  encounter_id              uuid,
  description               text        NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 300),
  code_system               text        CHECK (length(code_system) BETWEEN 1 AND 200),
  code                      text        CHECK (length(btrim(code)) BETWEEN 1 AND 60),
  onset_date                date,
  onset_precision           text        CHECK (onset_precision IN ('year', 'month', 'day')),
  -- As reported: still present, resolved, or not known. Not a clinical judgement of this organization.
  reported_status           text        NOT NULL CHECK (reported_status IN ('active', 'resolved', 'unknown')),
  -- Where it was diagnosed or treated, as reported.
  diagnosed_by              text        CHECK (length(btrim(diagnosed_by)) BETWEEN 1 AND 300),
  notes                     text        CHECK (length(btrim(notes)) BETWEEN 1 AND 2000),
  source                    text        NOT NULL CHECK (source IN ('reported', 'recorded_here')),
  reported_by               text        CHECK (reported_by IN ('patient', 'relative', 'other_provider')),
  source_description        text        CHECK (length(btrim(source_description)) BETWEEN 1 AND 300),
  recorder_practitioner_id  uuid,
  entered_in_error_reason   text        CHECK (length(btrim(entered_in_error_reason)) BETWEEN 3 AND 500),
  entered_in_error_by       uuid        REFERENCES app_user (id),
  entered_in_error_at       timestamptz,
  recorded_by               uuid        NOT NULL REFERENCES app_user (id),
  recorded_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)               REFERENCES patient (organization_id, id),
  FOREIGN KEY (patient_id, encounter_id)                  REFERENCES encounter (patient_id, id),
  FOREIGN KEY (organization_id, recorder_practitioner_id) REFERENCES practitioner (organization_id, id),
  CHECK ((onset_date IS NULL) = (onset_precision IS NULL)),
  CHECK (onset_precision IS DISTINCT FROM 'year' OR (extract(month FROM onset_date) = 1 AND extract(day FROM onset_date) = 1)),
  CHECK (onset_precision IS DISTINCT FROM 'month' OR extract(day FROM onset_date) = 1),
  CHECK ((code IS NULL) = (code_system IS NULL)),
  CHECK ((source = 'reported') = (reported_by IS NOT NULL)),
  CHECK ((entered_in_error_at IS NULL) = (entered_in_error_by IS NULL) AND (entered_in_error_at IS NULL) = (entered_in_error_reason IS NULL))
);
CREATE INDEX past_condition_patient_idx ON past_condition (organization_id, patient_id, recorded_at DESC);

-- ---- family history -------------------------------------------------------------------------------------------

CREATE TABLE family_history_entry (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid        NOT NULL,
  patient_id                uuid        NOT NULL,
  encounter_id              uuid,
  -- The relative, from a fixed clinical list (exported as HL7 v3 RoleCode), with free text for detail or "other".
  relationship              text        NOT NULL CHECK (relationship IN (
                                          'mother', 'father', 'sister', 'brother', 'sibling', 'half_sibling', 'daughter', 'son', 'child',
                                          'maternal_grandmother', 'maternal_grandfather', 'paternal_grandmother', 'paternal_grandfather',
                                          'maternal_aunt', 'maternal_uncle', 'paternal_aunt', 'paternal_uncle', 'cousin', 'other')),
  relationship_text         text        CHECK (length(btrim(relationship_text)) BETWEEN 1 AND 100),
  condition                 text        NOT NULL CHECK (length(btrim(condition)) BETWEEN 1 AND 300),
  code_system               text        CHECK (length(code_system) BETWEEN 1 AND 200),
  code                      text        CHECK (length(btrim(code)) BETWEEN 1 AND 60),
  onset_age                 smallint    CHECK (onset_age BETWEEN 0 AND 130),
  -- null: not stated.
  deceased                  boolean,
  cause_of_death            text        CHECK (length(btrim(cause_of_death)) BETWEEN 1 AND 300),
  notes                     text        CHECK (length(btrim(notes)) BETWEEN 1 AND 2000),
  source                    text        NOT NULL CHECK (source IN ('reported', 'external_import')),
  reported_by               text        CHECK (reported_by IN ('patient', 'relative', 'other_provider')),
  source_reference          text        CHECK (length(source_reference) BETWEEN 1 AND 300),
  declared_source           text        CHECK (length(declared_source) BETWEEN 1 AND 200),
  entered_in_error_reason   text        CHECK (length(btrim(entered_in_error_reason)) BETWEEN 3 AND 500),
  entered_in_error_by       uuid        REFERENCES app_user (id),
  entered_in_error_at       timestamptz,
  recorded_by               uuid        NOT NULL REFERENCES app_user (id),
  recorded_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id),
  FOREIGN KEY (patient_id, encounter_id)    REFERENCES encounter (patient_id, id),
  CHECK (relationship <> 'other' OR relationship_text IS NOT NULL),
  CHECK ((code IS NULL) = (code_system IS NULL)),
  CHECK (cause_of_death IS NULL OR deceased),
  CHECK ((source = 'reported') = (reported_by IS NOT NULL)),
  CHECK ((source = 'external_import') = (source_reference IS NOT NULL)),
  CHECK (source <> 'external_import' OR encounter_id IS NULL),
  CHECK ((entered_in_error_at IS NULL) = (entered_in_error_by IS NULL) AND (entered_in_error_at IS NULL) = (entered_in_error_reason IS NULL))
);
CREATE INDEX family_history_entry_patient_idx ON family_history_entry (organization_id, patient_id, recorded_at DESC);

-- The family history was asked about: complete as listed (reviewed), none known, or not known (adopted, not known, or
-- the patient declined to answer). Append-only; the latest review is the current state. "Not recorded" is the absence
-- of both entries and reviews.
CREATE TABLE family_history_review (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  patient_id       uuid        NOT NULL,
  encounter_id     uuid,
  outcome          text        NOT NULL CHECK (outcome IN ('reviewed', 'none_known', 'unknown')),
  unknown_reason   text        CHECK (unknown_reason IN ('adopted', 'not_known', 'declined_to_answer')),
  notes            text        CHECK (length(btrim(notes)) BETWEEN 1 AND 500),
  reviewed_by      uuid        NOT NULL REFERENCES app_user (id),
  reviewed_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id),
  FOREIGN KEY (patient_id, encounter_id)    REFERENCES encounter (patient_id, id),
  CHECK ((outcome = 'unknown') = (unknown_reason IS NOT NULL))
);
CREATE INDEX family_history_review_patient_idx ON family_history_review (organization_id, patient_id, reviewed_at DESC);
CREATE TRIGGER family_history_review_append_only BEFORE UPDATE OR DELETE ON family_history_review
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER family_history_review_no_truncate BEFORE TRUNCATE ON family_history_review
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();

-- ---- social history (versions) --------------------------------------------------------------------------------

CREATE TABLE social_history (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid        NOT NULL,
  patient_id                uuid        NOT NULL,
  encounter_id              uuid,
  -- The version this one replaced (the current version when it was recorded); null for the first.
  supersedes_id             uuid,
  -- The day the information was given (facility time zone); never before the version it replaces.
  effective_date            date        NOT NULL,
  tobacco_status            text        CHECK (tobacco_status IN ('never', 'former', 'current', 'unknown')),
  tobacco_type              text        CHECK (length(btrim(tobacco_type)) BETWEEN 1 AND 120),
  tobacco_amount            text        CHECK (length(btrim(tobacco_amount)) BETWEEN 1 AND 120),
  tobacco_quit_year         smallint    CHECK (tobacco_quit_year BETWEEN 1900 AND 2200),
  alcohol_status            text        CHECK (alcohol_status IN ('never', 'former', 'current', 'unknown')),
  alcohol_frequency         text        CHECK (length(btrim(alcohol_frequency)) BETWEEN 1 AND 200),
  -- Sensitive: shown only to users who also hold encounter.write, and to the patient in MyHealth.
  substance_use             text        CHECK (length(btrim(substance_use)) BETWEEN 1 AND 1000),
  occupation                text        CHECK (length(btrim(occupation)) BETWEEN 1 AND 200),
  occupational_exposures    text        CHECK (length(btrim(occupational_exposures)) BETWEEN 1 AND 1000),
  living_situation          text        CHECK (length(btrim(living_situation)) BETWEEN 1 AND 1000),
  physical_activity         text        CHECK (length(btrim(physical_activity)) BETWEEN 1 AND 1000),
  diet                      text        CHECK (length(btrim(diet)) BETWEEN 1 AND 1000),
  -- Sensitive, as above.
  sexual_history            text        CHECK (length(btrim(sexual_history)) BETWEEN 1 AND 1000),
  notes                     text        CHECK (length(btrim(notes)) BETWEEN 1 AND 2000),
  entered_in_error_reason   text        CHECK (length(btrim(entered_in_error_reason)) BETWEEN 3 AND 500),
  entered_in_error_by       uuid        REFERENCES app_user (id),
  entered_in_error_at       timestamptz,
  recorded_by               uuid        NOT NULL REFERENCES app_user (id),
  recorded_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)    REFERENCES patient (organization_id, id),
  FOREIGN KEY (patient_id, encounter_id)       REFERENCES encounter (patient_id, id),
  -- Not a same-patient key: after a merge the current version may be filed under a record merged into the patient.
  FOREIGN KEY (organization_id, supersedes_id) REFERENCES social_history (organization_id, id),
  CHECK (supersedes_id IS DISTINCT FROM id),
  CHECK (tobacco_status IN ('former', 'current') OR (tobacco_type IS NULL AND tobacco_amount IS NULL)),
  CHECK (tobacco_status = 'former' OR tobacco_quit_year IS NULL),
  CHECK (alcohol_status IN ('former', 'current') OR alcohol_frequency IS NULL),
  CHECK (num_nonnulls(tobacco_status, alcohol_status, substance_use, occupation, occupational_exposures, living_situation,
                      physical_activity, diet, sexual_history, notes) > 0),
  CHECK ((entered_in_error_at IS NULL) = (entered_in_error_by IS NULL) AND (entered_in_error_at IS NULL) = (entered_in_error_reason IS NULL))
);
CREATE INDEX social_history_patient_idx ON social_history (organization_id, patient_id, recorded_at DESC);
-- A version is replaced once: two versions recorded from the same current one conflict (a replacement marked entered in
-- error no longer counts, so the version it replaced can be replaced again).
CREATE UNIQUE INDEX social_history_supersedes_uq ON social_history (supersedes_id)
  WHERE supersedes_id IS NOT NULL AND entered_in_error_at IS NULL;

-- ---- immutability: only marking entered in error, once ----------------------------------------------------------

CREATE FUNCTION patient_history_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable constant text[] := ARRAY['entered_in_error_reason', 'entered_in_error_by', 'entered_in_error_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows are never deleted; mark them entered in error', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable)
     OR OLD.entered_in_error_at IS NOT NULL
     OR NEW.entered_in_error_at IS NULL THEN
    RAISE EXCEPTION '%: only marking entered in error, once, is permitted', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['past_procedure', 'past_condition', 'family_history_entry', 'social_history'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION patient_history_guard()', t || '_guard', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation()', t || '_no_truncate', t);
  END LOOP;
  -- No new care filed under a merged record (ADR-0009, migration 0068).
  FOREACH t IN ARRAY ARRAY['past_procedure', 'past_condition', 'family_history_entry', 'family_history_review', 'social_history'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION refuse_record_for_merged_patient()',
                   t || '_not_for_merged_patient', t);
  END LOOP;
END;
$$;

-- ---- FHIR imports: an accepted Procedure or FamilyMemberHistory becomes a history entry ---------------------------
-- (Conditions stay external history, as before; entries accepted earlier are untouched.)

ALTER TABLE fhir_import_entry DROP CONSTRAINT fhir_import_entry_kind_check;
ALTER TABLE fhir_import_entry ADD CONSTRAINT fhir_import_entry_kind_check
  CHECK (kind IN ('patient', 'allergy', 'condition', 'observation', 'medication', 'document', 'immunization', 'procedure', 'family_history', 'not_supported'));
ALTER TABLE fhir_import_entry DROP CONSTRAINT fhir_import_entry_result_type_check;
ALTER TABLE fhir_import_entry ADD CONSTRAINT fhir_import_entry_result_type_check
  CHECK (result_type IN ('allergy_intolerance', 'external_history_entry', 'immunization', 'past_procedure', 'family_history_entry', 'patient'));

-- ---- copies of the record may include the history -------------------------------------------------------------

ALTER TABLE records_request_export DROP CONSTRAINT records_request_export_sections_check;
ALTER TABLE records_request_export ADD CONSTRAINT records_request_export_sections_check CHECK (cardinality(sections) > 0 AND sections <@ ARRAY[
  'allergies', 'consultations', 'laboratory', 'prescriptions', 'care_plans', 'dental', 'certificates', 'documents', 'immunizations', 'history'
]::text[]);
