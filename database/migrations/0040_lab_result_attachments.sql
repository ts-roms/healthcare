-- Laboratory result attachments (Phase 3 follow-up). See docs/domains/laboratory.md#result-attachments.
--
-- A result version may carry files: instrument printouts, images (e.g. a smear or culture plate), an outsourced
-- laboratory's own report. The files are private documents (libs/documents, object storage); the link belongs to the
-- laboratory. Attachments are added or removed only while the version is being entered: from verification on, what
-- was verified, approved and released never changes (a correction is a new version with its own attachments).

-- Documents managed by a domain are served only through that domain (which applies its own visibility rules — e.g.
-- nothing of an unreleased result reaches clinicians or exports); the generic documents API does not list or serve them.
ALTER TABLE document ADD COLUMN managed_by text CHECK (managed_by IN ('laboratory'));

CREATE TABLE lab_result_attachment (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  facility_id      uuid        NOT NULL,
  patient_id       uuid        NOT NULL,
  result_id        uuid        NOT NULL,
  document_id      uuid        NOT NULL UNIQUE,
  title            text        NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  -- What was attached, as registered (the file itself is the document's).
  file_name        text        NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 200),
  content_type     text        NOT NULL,
  size_bytes       bigint      NOT NULL CHECK (size_bytes > 0),
  -- pending: registered, file not yet verified in storage; attached: part of the result version; removed: taken off
  -- before verification (kept, with who, when and why).
  status           text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'attached', 'removed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  attached_at      timestamptz,
  removed_at       timestamptz,
  removed_by       uuid        REFERENCES app_user (id),
  removal_reason   text,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id)             REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, result_id)               REFERENCES lab_result (organization_id, id),
  FOREIGN KEY (patient_id, result_id)                    REFERENCES lab_result (patient_id, id),
  FOREIGN KEY (organization_id, patient_id, document_id) REFERENCES document (organization_id, patient_id, id),
  CHECK (status <> 'attached' OR attached_at IS NOT NULL),
  CHECK ((status = 'removed') = (removed_at IS NOT NULL)),
  CHECK (removed_at IS NULL OR (removed_by IS NOT NULL AND length(btrim(removal_reason)) BETWEEN 5 AND 500))
);
CREATE INDEX lab_result_attachment_result_idx ON lab_result_attachment (result_id) WHERE status <> 'removed';

-- Attachments change only while their result version is being entered, and are never deleted.
CREATE FUNCTION lab_result_attachment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  result_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'laboratory result attachments are not deleted' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'removed' THEN RAISE EXCEPTION 'a removed attachment cannot change' USING ERRCODE = 'check_violation'; END IF;
    IF NEW.result_id <> OLD.result_id OR NEW.document_id <> OLD.document_id OR NEW.patient_id <> OLD.patient_id THEN
      RAISE EXCEPTION 'an attachment cannot move to another result or document' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  SELECT status INTO result_status FROM lab_result WHERE id = NEW.result_id;
  IF result_status IS DISTINCT FROM 'entered' THEN
    RAISE EXCEPTION 'attachments change only while the result is entered (it is %)', result_status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_result_attachment_frozen BEFORE INSERT OR UPDATE OR DELETE ON lab_result_attachment
  FOR EACH ROW EXECUTE FUNCTION lab_result_attachment_guard();
