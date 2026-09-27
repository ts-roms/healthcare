-- A consent's supporting document (e.g. the signed form) must belong to the
-- same patient. The original foreign key (0006) only required the same
-- organization. Documents without a patient cannot back a consent.

ALTER TABLE document
  ADD CONSTRAINT document_organization_patient_id_key UNIQUE (organization_id, patient_id, id);

ALTER TABLE patient_consent
  DROP CONSTRAINT patient_consent_organization_id_document_id_fkey;

ALTER TABLE patient_consent
  ADD CONSTRAINT patient_consent_document_same_patient_fkey
  FOREIGN KEY (organization_id, patient_id, document_id) REFERENCES document (organization_id, patient_id, id);
