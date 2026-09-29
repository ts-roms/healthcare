-- Patient merge: "link, don't move" (docs/domains/patient.md, ADR-0009 in docs/architecture/decisions.md).
-- Merging a duplicate never rewrites what is filed under it: the retired record gets status 'merged' and
-- merged_into_patient_id = the surviving record (columns and checks from 0005). Every patient view then reads the
-- survivor's records and those of every record merged into it. Unmerge is exact because nothing moved.

INSERT INTO permission (key, description)
VALUES ('patient.merge', 'Merge a duplicate patient record into the surviving record, and undo a merge');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'patient.merge' FROM role r
WHERE r.key IN ('org_admin', 'records_officer') AND r.is_system
ON CONFLICT DO NOTHING;

-- Append-only history of merges, unmerges and the re-pointing that keeps merge chains flat.
--   merged     the retired record was merged into the survivor (previous_status: its status before)
--   unmerged   the merge was undone (previous_status: the status it was given back)
--   repointed  a record already merged into `related` was re-pointed to the survivor because `related` was itself
--              merged (or back, when that merge was undone); related_merge_id names that merge or unmerge
CREATE TABLE patient_merge (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid        NOT NULL REFERENCES organization (id),
  retired_patient_id   uuid        NOT NULL,
  survivor_patient_id  uuid        NOT NULL,
  action               text        NOT NULL CHECK (action IN ('merged', 'unmerged', 'repointed')),
  previous_status      text        CHECK (previous_status IN ('active', 'inactive', 'deceased')),
  reason               text        NOT NULL CHECK (length(btrim(reason)) > 0 AND length(reason) <= 1000),
  related_merge_id     uuid,
  -- What the person reviewed (patient numbers, versions, flagged differences and acknowledgements, portal handling).
  -- Identifiers only; no clinical content.
  snapshot             jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(snapshot) = 'object'),
  performed_by         uuid        NOT NULL REFERENCES app_user (id),
  performed_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, retired_patient_id) REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, survivor_patient_id) REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, related_merge_id) REFERENCES patient_merge (organization_id, id),
  CHECK (retired_patient_id <> survivor_patient_id),
  CHECK (action = 'repointed' OR previous_status IS NOT NULL),
  CHECK ((action = 'repointed') = (related_merge_id IS NOT NULL))
);
CREATE INDEX patient_merge_retired_idx  ON patient_merge (retired_patient_id, performed_at DESC);
CREATE INDEX patient_merge_survivor_idx ON patient_merge (survivor_patient_id, performed_at DESC);

CREATE TRIGGER patient_merge_no_update_delete
  BEFORE UPDATE OR DELETE ON patient_merge
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER patient_merge_no_truncate
  BEFORE TRUNCATE ON patient_merge
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();

-- Resolving links: the records merged into a survivor.
CREATE INDEX patient_merged_into_idx ON patient (merged_into_patient_id) WHERE merged_into_patient_id IS NOT NULL;

-- A survivor is never itself merged: merged_into_patient_id always names the final survivor (flat chains, no cycles).
-- The merge command keeps chains flat in its transaction; this deferred check makes it an invariant.
CREATE FUNCTION patient_merge_chain_is_flat() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.merged_into_patient_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM patient s WHERE s.id = NEW.merged_into_patient_id AND s.merged_into_patient_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM patient r WHERE r.merged_into_patient_id = NEW.id) THEN
    RAISE EXCEPTION 'merge chains must stay flat: patient % cannot be merged into a merged record or keep records merged into it', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'patient_merge_chain_flat';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER patient_merge_chain_flat
  AFTER UPDATE OF merged_into_patient_id ON patient
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION patient_merge_chain_is_flat();

-- The Patient Master's read contract for other domains (ADR-0009): the ids filed as one patient — the record itself
-- and every record merged into it. Other libraries never read the patient table; they call these functions through
-- the helpers in libs/core (filedAsPatient, canonicalPatientId).
CREATE FUNCTION patient_record_ids(p_patient_id uuid) RETURNS uuid[]
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_agg(id), ARRAY[p_patient_id]) FROM patient WHERE id = p_patient_id OR merged_into_patient_id = p_patient_id
$$;

-- The surviving record a patient id is filed as (itself unless merged).
CREATE FUNCTION patient_canonical_id(p_patient_id uuid) RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT coalesce((SELECT merged_into_patient_id FROM patient WHERE id = p_patient_id), p_patient_id)
$$;

-- No new care is filed under a merged record: new appointments, visits, triage, vitals, allergies, encounters,
-- prescriptions, care plans, laboratory orders, dental records, imported history, PhilHealth answers and
-- package enrollments go to the survivor. Corrections to what already exists (amendments, entered in error, results
-- of work finished before the merge, billing of existing charges) are not refused. The row lock waits for a merge in
-- progress, so nothing slips in between the merge's blocker check and its commit. Documents are checked by the
-- documents service on upload instead (generated reports of earlier work are still archived under their record).
-- SQLSTATE PM001 is mapped to 422 patient_merged by the API (libs/core exception filter); DETAIL carries the
-- survivor's id.
CREATE FUNCTION refuse_record_for_merged_patient() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  survivor uuid;
BEGIN
  IF NEW.patient_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT merged_into_patient_id INTO survivor FROM patient WHERE id = NEW.patient_id FOR SHARE;
  IF survivor IS NOT NULL THEN
    RAISE EXCEPTION 'patient % was merged into another record; file this under the surviving record', NEW.patient_id
      USING ERRCODE = 'PM001', DETAIL = survivor::text;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'appointment', 'appointment_waitlist_entry', 'visit', 'triage_assessment', 'vital_sign_set', 'allergy_intolerance',
    'allergy_review', 'encounter', 'prescription', 'care_plan', 'lab_order', 'dental_examination', 'dental_treatment_plan',
    'dental_image', 'dental_perio_chart', 'external_history_entry', 'philhealth_eligibility_check',
    'philhealth_yakap_registration', 'billing_package_enrollment'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION refuse_record_for_merged_patient()',
      t || '_not_for_merged_patient', t);
  END LOOP;
END;
$$;
