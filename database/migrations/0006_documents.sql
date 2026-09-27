-- Document metadata. Binary content lives in S3-compatible object storage.
CREATE TABLE document (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  facility_id      uuid,
  patient_id       uuid,
  category         text        NOT NULL CHECK (category IN
                     ('consent_form', 'identification', 'medical_certificate', 'laboratory_report', 'imaging',
                      'referral_letter', 'prescription', 'clinical_attachment', 'billing', 'other')),
  title            text        NOT NULL CHECK (length(btrim(title)) > 0),
  file_name        text        NOT NULL CHECK (length(btrim(file_name)) > 0),
  content_type     text        NOT NULL,
  size_bytes       bigint      NOT NULL CHECK (size_bytes > 0),
  storage_key      text        NOT NULL UNIQUE,
  status           text        NOT NULL DEFAULT 'pending_upload' CHECK (status IN ('pending_upload', 'available', 'archived')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  uploaded_at      timestamptz,
  archived_at      timestamptz,
  archived_by      uuid        REFERENCES app_user (id),
  archive_reason   text,
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)  REFERENCES patient (organization_id, id),
  CHECK (status = 'pending_upload' OR uploaded_at IS NOT NULL),
  CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
  CHECK (archived_at IS NULL OR (archived_by IS NOT NULL AND length(btrim(archive_reason)) > 0))
);
CREATE INDEX document_patient_idx ON document (patient_id, created_at DESC) WHERE patient_id IS NOT NULL;

ALTER TABLE patient_consent
  ADD FOREIGN KEY (organization_id, document_id) REFERENCES document (organization_id, id);
