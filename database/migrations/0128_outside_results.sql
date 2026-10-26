-- Results from outside laboratories and hospitals (docs/domains/outside-results.md).
--
-- Staff file a result a patient brought, or another provider sent, on the patient's record: the uploaded report (a
-- private document) with the source as written, the day it was done and the tests as named on it. An outside result is
-- never one of this laboratory's results: it is not entered, verified, approved or released here, has no reference
-- range or flag the platform evaluated, and never joins this laboratory's trends. Nothing in the report is read,
-- extracted or interpreted by the platform. A record never changes except: it is marked entered in error with a reason
-- (never deleted; the document stays in storage under its own retention).

-- ---- permissions --------------------------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('outside-result.read',   'View results from outside laboratories and hospitals filed on a patient''s record'),
  ('outside-result.record', 'File a result from an outside laboratory or hospital and mark a filing entered in error');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('org_admin', 'outside-result.read'), ('org_admin', 'outside-result.record'),
  ('physician', 'outside-result.read'), ('physician', 'outside-result.record'),
  ('nurse', 'outside-result.read'), ('nurse', 'outside-result.record'),
  ('receptionist', 'outside-result.read'), ('receptionist', 'outside-result.record'),
  ('records_officer', 'outside-result.read'), ('records_officer', 'outside-result.record'),
  ('dentist', 'outside-result.read')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system
ON CONFLICT DO NOTHING;

-- ---- documents: a category of their own ---------------------------------------------------------------------

ALTER TABLE document DROP CONSTRAINT document_category_check;
ALTER TABLE document ADD CONSTRAINT document_category_check CHECK (category IN
  ('consent_form', 'identification', 'medical_certificate', 'laboratory_report', 'imaging',
   'referral_letter', 'prescription', 'clinical_attachment', 'billing', 'other', 'record_copy', 'management_report',
   'outside_result'));

-- ---- outside results ----------------------------------------------------------------------------------------

CREATE TABLE outside_result (
  id                      uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid         NOT NULL,
  patient_id              uuid         NOT NULL,
  -- The facility the staff member was working at when they filed it.
  facility_id             uuid,
  -- The report as uploaded (a private document of the same patient, checked when filed).
  document_id             uuid         NOT NULL,
  -- Who performed it, as written on the report (never matched to a reference laboratory or facility of ours).
  source_name             text         NOT NULL CHECK (length(btrim(source_name)) BETWEEN 2 AND 200),
  source_kind             text         NOT NULL CHECK (source_kind IN ('laboratory', 'hospital', 'clinic', 'other')),
  -- The day the specimen was taken or the test done, as stated on the report.
  performed_on            date         NOT NULL,
  -- The tests as named on the report (free text; no code set assumed).
  tests                   text         NOT NULL CHECK (length(btrim(tests)) BETWEEN 2 AND 500),
  -- How it reached the clinic: the patient brought it, the provider sent it, or something else.
  received_from           text         NOT NULL CHECK (received_from IN ('patient', 'provider', 'other')),
  notes                   text         CHECK (length(btrim(notes)) BETWEEN 1 AND 2000),
  entered_in_error_reason text         CHECK (length(btrim(entered_in_error_reason)) BETWEEN 3 AND 500),
  entered_in_error_by     uuid         REFERENCES app_user (id),
  entered_in_error_at     timestamptz,
  recorded_by             uuid         NOT NULL REFERENCES app_user (id),
  recorded_at             timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)  REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, document_id) REFERENCES document (organization_id, id),
  CHECK ((entered_in_error_at IS NULL) = (entered_in_error_by IS NULL) AND (entered_in_error_at IS NULL) = (entered_in_error_reason IS NULL))
);
-- A report is filed once (a second filing of the same document would be a duplicate).
CREATE UNIQUE INDEX outside_result_document_once ON outside_result (organization_id, document_id) WHERE entered_in_error_at IS NULL;
CREATE INDEX outside_result_patient_idx ON outside_result (organization_id, patient_id, performed_on DESC);
CREATE INDEX outside_result_patient_recorded_idx ON outside_result (organization_id, patient_id, recorded_at DESC);

-- Immutable except marking entered in error, once. Never deleted.
CREATE FUNCTION outside_result_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable constant text[] := ARRAY['entered_in_error_reason', 'entered_in_error_by', 'entered_in_error_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'outside results are never deleted; mark them entered in error' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable)
     OR (OLD.entered_in_error_at IS NOT NULL AND (NEW.entered_in_error_at, NEW.entered_in_error_by, NEW.entered_in_error_reason)
                                                 IS DISTINCT FROM (OLD.entered_in_error_at, OLD.entered_in_error_by, OLD.entered_in_error_reason)) THEN
    RAISE EXCEPTION 'outside result: only marking entered in error, once, is permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER outside_result_guard BEFORE UPDATE OR DELETE ON outside_result FOR EACH ROW EXECUTE FUNCTION outside_result_guard();
CREATE TRIGGER outside_result_no_truncate BEFORE TRUNCATE ON outside_result FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();

-- No new care filed under a merged record (ADR-0009, migration 0068).
CREATE TRIGGER outside_result_not_for_merged_patient BEFORE INSERT ON outside_result
  FOR EACH ROW EXECUTE FUNCTION refuse_record_for_merged_patient();
