-- Copies of the record for a records request (docs/domains/records-requests.md, "Copy of the record"). The records
-- office compiles the sections of a patient's record a request asks for, over its period, into one PDF stored as a
-- `record_copy` document of the patient (generated, private object storage), which it can then share in answer.
-- Each compilation is recorded once and never changes; a new one is a new document.

ALTER TABLE document DROP CONSTRAINT document_category_check;
ALTER TABLE document ADD CONSTRAINT document_category_check CHECK (category IN
  ('consent_form', 'identification', 'medical_certificate', 'laboratory_report', 'imaging',
   'referral_letter', 'prescription', 'clinical_attachment', 'billing', 'other', 'record_copy'));

CREATE TABLE records_request_export (
  -- The stored PDF's document id.
  id               uuid        PRIMARY KEY,
  organization_id  uuid        NOT NULL,
  request_id       uuid        NOT NULL,
  patient_id       uuid        NOT NULL,
  sections         text[]      NOT NULL CHECK (cardinality(sections) > 0 AND sections <@ ARRAY[
                     'allergies', 'consultations', 'laboratory', 'prescriptions', 'care_plans', 'dental', 'certificates', 'documents'
                   ]::text[]),
  period_from      date,
  period_to        date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  FOREIGN KEY (organization_id, request_id)            REFERENCES records_request (organization_id, id),
  FOREIGN KEY (patient_id, request_id)                 REFERENCES records_request (patient_id, id),
  FOREIGN KEY (organization_id, patient_id, id)        REFERENCES document (organization_id, patient_id, id),
  CHECK (period_from IS NULL OR period_to IS NULL OR period_from <= period_to)
);

CREATE INDEX records_request_export_request ON records_request_export (request_id, created_at);

CREATE TRIGGER records_request_export_append_only BEFORE UPDATE OR DELETE ON records_request_export
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
