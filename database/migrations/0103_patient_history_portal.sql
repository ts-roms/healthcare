-- Patient history reported in MyHealth (docs/domains/patient-history.md, "Reported by the patient in MyHealth").
--
-- A patient (or a guardian acting for a dependent) answers a history questionnaire in MyHealth and adds medicines they
-- take: the answers are written as ordinary history entries — reported by the patient (or a relative), without a staff
-- recorder — and labelled as recorded through the portal, so the clinic sees who told it what and corrects a mistake
-- the usual way (entered in error plus a new entry). Nothing is reviewed into the record automatically: the history
-- was never a clinical judgement of the organization. Substance use and sexual history are not asked in MyHealth.
-- Each completed questionnaire is kept as an append-only submission, so the clinic knows one came in.

-- ---- who recorded an entry: a staff user, or a MyHealth account ----------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['past_procedure', 'past_condition', 'reported_medication', 'family_history_entry', 'social_history'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN recorded_by DROP NOT NULL', t);
    EXECUTE format($f$ALTER TABLE %1$I
      ADD COLUMN recorded_via     text NOT NULL DEFAULT 'staff' CHECK (recorded_via IN ('staff', 'patient_portal')),
      ADD COLUMN portal_account_id uuid,
      ADD COLUMN proxy_grant_id    uuid REFERENCES portal_proxy_grant (id),
      ADD CONSTRAINT %1$s_portal_account_fkey FOREIGN KEY (organization_id, portal_account_id) REFERENCES patient_portal_account (organization_id, id),
      -- A staff entry names its user; a portal entry names the MyHealth account instead (a guardian's grant when acting).
      ADD CONSTRAINT %1$s_recorded_via_staff CHECK ((recorded_via = 'staff') = (recorded_by IS NOT NULL)),
      ADD CONSTRAINT %1$s_recorded_via_portal CHECK ((recorded_via = 'patient_portal') = (portal_account_id IS NOT NULL)),
      ADD CONSTRAINT %1$s_proxy_only_portal CHECK (proxy_grant_id IS NULL OR recorded_via = 'patient_portal')$f$, t);
  END LOOP;
END;
$$;

-- A portal entry is always "reported" by the patient or a relative, outside a consultation, without a clinician's
-- notes or recorder.
ALTER TABLE past_procedure ADD CONSTRAINT past_procedure_portal_shape CHECK (recorded_via <> 'patient_portal'
  OR (source = 'reported' AND reported_by IN ('patient', 'relative') AND encounter_id IS NULL AND recorder_practitioner_id IS NULL AND notes IS NULL));
ALTER TABLE past_condition ADD CONSTRAINT past_condition_portal_shape CHECK (recorded_via <> 'patient_portal'
  OR (source = 'reported' AND reported_by IN ('patient', 'relative') AND encounter_id IS NULL AND recorder_practitioner_id IS NULL AND notes IS NULL));
ALTER TABLE reported_medication ADD CONSTRAINT reported_medication_portal_shape CHECK (recorded_via <> 'patient_portal'
  OR (source = 'reported' AND reported_by IN ('patient', 'relative') AND encounter_id IS NULL AND recorder_practitioner_id IS NULL AND notes IS NULL));
ALTER TABLE family_history_entry ADD CONSTRAINT family_history_entry_portal_shape CHECK (recorded_via <> 'patient_portal'
  OR (source = 'reported' AND reported_by IN ('patient', 'relative') AND encounter_id IS NULL AND notes IS NULL));
-- A social history version from MyHealth carries the sensitive parts over from the current version; it never sets them.
ALTER TABLE social_history ADD CONSTRAINT social_history_portal_shape CHECK (recorded_via <> 'patient_portal' OR (encounter_id IS NULL AND notes IS NULL));

-- ---- a medicine marked stopped by the patient ---------------------------------------------------------------------

DO $$
DECLARE
  c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
  WHERE conrelid = 'reported_medication'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%(stop_recorded_at IS NULL) = (stop_recorded_by IS NULL)%';
  IF c IS NULL THEN RAISE EXCEPTION 'reported_medication stop check not found'; END IF;
  EXECUTE format('ALTER TABLE reported_medication DROP CONSTRAINT %I', c);
END;
$$;

ALTER TABLE reported_medication
  ADD COLUMN stop_portal_account_id uuid,
  ADD CONSTRAINT reported_medication_stop_portal_account_fkey FOREIGN KEY (organization_id, stop_portal_account_id) REFERENCES patient_portal_account (organization_id, id),
  -- The stop is recorded by a staff user or a MyHealth account, never both, and only once it is recorded at all.
  ADD CONSTRAINT reported_medication_stop_recorder CHECK (
    (stop_recorded_at IS NULL) = (stop_recorded_by IS NULL AND stop_portal_account_id IS NULL)
    AND NOT (stop_recorded_by IS NOT NULL AND stop_portal_account_id IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION reported_medication_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable constant text[] := ARRAY[
    'entered_in_error_reason', 'entered_in_error_by', 'entered_in_error_at',
    'stop_recorded_at', 'stop_recorded_by', 'stop_portal_account_id', 'stop_note', 'stopped_date', 'stopped_precision'
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
  stop_changed := (NEW.stop_recorded_at, NEW.stop_recorded_by, NEW.stop_portal_account_id, NEW.stop_note, NEW.stopped_date, NEW.stopped_precision)
    IS DISTINCT FROM (OLD.stop_recorded_at, OLD.stop_recorded_by, OLD.stop_portal_account_id, OLD.stop_note, OLD.stopped_date, OLD.stopped_precision);
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

-- ---- a questionnaire completed in MyHealth ---------------------------------------------------------------------------

-- One row per questionnaire the patient (or a guardian) sent: which sections were answered and the entries it wrote.
-- A retry with the same Idempotency-Key from the same account returns the first submission.
CREATE TABLE patient_history_submission (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL,
  patient_id         uuid        NOT NULL,
  portal_account_id  uuid        NOT NULL,
  proxy_grant_id     uuid        REFERENCES portal_proxy_grant (id),
  sections           text[]      NOT NULL CHECK (cardinality(sections) BETWEEN 1 AND 5
                                   AND sections <@ ARRAY['procedure', 'condition', 'medication', 'family', 'social']::text[]),
  entry_ids          uuid[]      NOT NULL DEFAULT '{}',
  idempotency_key    text        CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)        REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, portal_account_id) REFERENCES patient_portal_account (organization_id, id)
);
CREATE UNIQUE INDEX patient_history_submission_idempotency_uq ON patient_history_submission (portal_account_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX patient_history_submission_patient_idx ON patient_history_submission (organization_id, patient_id, submitted_at DESC);

CREATE TRIGGER patient_history_submission_append_only BEFORE UPDATE OR DELETE ON patient_history_submission
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER patient_history_submission_no_truncate BEFORE TRUNCATE ON patient_history_submission
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER patient_history_submission_not_for_merged_patient BEFORE INSERT ON patient_history_submission
  FOR EACH ROW EXECUTE FUNCTION refuse_record_for_merged_patient();
