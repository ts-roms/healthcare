-- Medications taken: what the patient takes that this organization did not prescribe here — prescribed elsewhere,
-- bought over the counter, or taken as supplements or traditional remedies — as the patient, a relative or another
-- provider reports it, or as a clinician documents it from records the patient brought
-- (docs/domains/patient-history.md, "Medications taken").
--
-- A section of the patient history (migration 0082): read and recorded with history.read / history.record, never a
-- prescription of the organization, never dispensed or billed, and not checked by drug–allergy decision support (the
-- names are as written; no drug terminology is assumed). An optional code is kept under a code-system key the
-- organization names, as for the rest of the history.
--
-- A stop date is not before the start at the precisions known (checked by the API: "2019" can follow "May 2019").
--
-- Rows are immutable except for two things, each once, each with who and when: the medicine was stopped (with the stop
-- date as known and an optional note), and the entry was entered in error (with a reason). A medicine recorded as
-- already stopped cannot be stopped again. Nothing is ever deleted.

CREATE TABLE reported_medication (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid        NOT NULL,
  patient_id                uuid        NOT NULL,
  -- The consultation in which the history was taken (optional).
  encounter_id              uuid,
  -- The medicine as written (e.g. "Losartan 50 mg tablet", "Lagundi syrup").
  medication                text        NOT NULL CHECK (length(btrim(medication)) BETWEEN 1 AND 200),
  code_system               text        CHECK (length(code_system) BETWEEN 1 AND 200),
  code                      text        CHECK (length(btrim(code)) BETWEEN 1 AND 60),
  -- How the patient takes it, as said (e.g. "1 tablet every morning").
  dose_text                 text        CHECK (length(btrim(dose_text)) BETWEEN 1 AND 200),
  -- What it is for, as reported.
  reason                    text        CHECK (length(btrim(reason)) BETWEEN 1 AND 300),
  -- Who prescribed it or where it came from, as reported (e.g. "Cardiologist at another hospital", "Over the counter").
  prescribed_by             text        CHECK (length(btrim(prescribed_by)) BETWEEN 1 AND 300),
  started_date              date,
  started_precision         text        CHECK (started_precision IN ('year', 'month', 'day')),
  -- As reported when recorded: still taking, already stopped, or not known. Not a judgement of this organization.
  reported_status           text        NOT NULL CHECK (reported_status IN ('taking', 'stopped', 'unknown')),
  -- When it was stopped, as precise as known (recorded with the entry, or later when marked stopped).
  stopped_date              date,
  stopped_precision         text        CHECK (stopped_precision IN ('year', 'month', 'day')),
  notes                     text        CHECK (length(btrim(notes)) BETWEEN 1 AND 2000),
  source                    text        NOT NULL CHECK (source IN ('reported', 'recorded_here')),
  reported_by               text        CHECK (reported_by IN ('patient', 'relative', 'other_provider')),
  source_description        text        CHECK (length(btrim(source_description)) BETWEEN 1 AND 300),
  recorder_practitioner_id  uuid,
  -- Marked stopped after it was recorded (once): who, when and an optional note.
  stop_recorded_at          timestamptz,
  stop_recorded_by          uuid        REFERENCES app_user (id),
  stop_note                 text        CHECK (length(btrim(stop_note)) BETWEEN 1 AND 500),
  entered_in_error_reason   text        CHECK (length(btrim(entered_in_error_reason)) BETWEEN 3 AND 500),
  entered_in_error_by       uuid        REFERENCES app_user (id),
  entered_in_error_at       timestamptz,
  recorded_by               uuid        NOT NULL REFERENCES app_user (id),
  recorded_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)               REFERENCES patient (organization_id, id),
  FOREIGN KEY (patient_id, encounter_id)                  REFERENCES encounter (patient_id, id),
  FOREIGN KEY (organization_id, recorder_practitioner_id) REFERENCES practitioner (organization_id, id),
  CHECK ((started_date IS NULL) = (started_precision IS NULL)),
  CHECK (started_precision IS DISTINCT FROM 'year' OR (extract(month FROM started_date) = 1 AND extract(day FROM started_date) = 1)),
  CHECK (started_precision IS DISTINCT FROM 'month' OR extract(day FROM started_date) = 1),
  CHECK ((stopped_date IS NULL) = (stopped_precision IS NULL)),
  CHECK (stopped_precision IS DISTINCT FROM 'year' OR (extract(month FROM stopped_date) = 1 AND extract(day FROM stopped_date) = 1)),
  CHECK (stopped_precision IS DISTINCT FROM 'month' OR extract(day FROM stopped_date) = 1),
  -- A stop date belongs to a medicine recorded as stopped or marked stopped later.
  CHECK (stopped_date IS NULL OR reported_status = 'stopped' OR stop_recorded_at IS NOT NULL),
  CHECK ((stop_recorded_at IS NULL) = (stop_recorded_by IS NULL)),
  CHECK (stop_note IS NULL OR stop_recorded_at IS NOT NULL),
  CHECK (stop_recorded_at IS NULL OR reported_status <> 'stopped'),
  CHECK ((code IS NULL) = (code_system IS NULL)),
  CHECK ((source = 'reported') = (reported_by IS NOT NULL)),
  CHECK ((entered_in_error_at IS NULL) = (entered_in_error_by IS NULL) AND (entered_in_error_at IS NULL) = (entered_in_error_reason IS NULL))
);
CREATE INDEX reported_medication_patient_idx ON reported_medication (organization_id, patient_id, recorded_at DESC);

-- Only the stop (once, not for a medicine recorded as stopped) and the entered-in-error mark (once) may be written after
-- the row is recorded; nothing changes once it is in error; nothing is deleted.
CREATE FUNCTION reported_medication_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable constant text[] := ARRAY[
    'entered_in_error_reason', 'entered_in_error_by', 'entered_in_error_at',
    'stop_recorded_at', 'stop_recorded_by', 'stop_note', 'stopped_date', 'stopped_precision'
  ];
  stop_changed boolean;
  error_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reported_medication rows are never deleted; mark them entered in error' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) OR OLD.entered_in_error_at IS NOT NULL THEN
    RAISE EXCEPTION 'reported_medication: only marking stopped or entered in error, once each, is permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  stop_changed := (NEW.stop_recorded_at, NEW.stop_recorded_by, NEW.stop_note, NEW.stopped_date, NEW.stopped_precision)
    IS DISTINCT FROM (OLD.stop_recorded_at, OLD.stop_recorded_by, OLD.stop_note, OLD.stopped_date, OLD.stopped_precision);
  error_changed := (NEW.entered_in_error_at, NEW.entered_in_error_by, NEW.entered_in_error_reason)
    IS DISTINCT FROM (OLD.entered_in_error_at, OLD.entered_in_error_by, OLD.entered_in_error_reason);
  IF stop_changed AND (OLD.stop_recorded_at IS NOT NULL OR NEW.stop_recorded_at IS NULL OR OLD.reported_status = 'stopped') THEN
    RAISE EXCEPTION 'reported_medication: a medicine is marked stopped once, and not when it was recorded as stopped' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF error_changed AND NEW.entered_in_error_at IS NULL THEN
    RAISE EXCEPTION 'reported_medication: an entered-in-error mark cannot be removed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reported_medication_guard BEFORE UPDATE OR DELETE ON reported_medication FOR EACH ROW EXECUTE FUNCTION reported_medication_guard();
CREATE TRIGGER reported_medication_no_truncate BEFORE TRUNCATE ON reported_medication FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();
-- No new care filed under a merged record (ADR-0009, migration 0068).
CREATE TRIGGER reported_medication_not_for_merged_patient BEFORE INSERT ON reported_medication
  FOR EACH ROW EXECUTE FUNCTION refuse_record_for_merged_patient();

UPDATE permission SET description =
  'View a patient''s past procedures and conditions, medications taken, family and social history (substance use and sexual history also need encounter.write)'
WHERE key = 'history.read';
UPDATE permission SET description =
  'Record past procedures and conditions, medications taken (and mark them stopped), family history and its review, new social history versions, and mark entries entered in error'
WHERE key = 'history.record';
