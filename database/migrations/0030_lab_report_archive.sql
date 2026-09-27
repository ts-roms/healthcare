-- Archived laboratory reports (Phase 3 follow-up). See docs/architecture/printable-documents.md.
--
-- Each time results of an order are released, the report as it stands then (the set of released result versions) is
-- rendered to PDF in the background and kept in private object storage as a document of the patient. One archive per
-- order and set of result versions: a correction produces a new set, so a new archived version; nothing is replaced.

-- Documents the platform generates itself (no uploading user).
ALTER TABLE document ADD COLUMN source text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'generated'));
ALTER TABLE document ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE document ADD CONSTRAINT document_created_by_check CHECK (created_by IS NOT NULL OR source = 'generated');

CREATE TABLE lab_report_archive (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  facility_id      uuid        NOT NULL,
  patient_id       uuid        NOT NULL,
  order_id         uuid        NOT NULL,
  -- 1, 2, … per order, in release order.
  archive_version  smallint    NOT NULL CHECK (archive_version > 0),
  -- The released result versions the report shows, sorted; result_set_key is their SHA-256 (the idempotency key).
  result_ids       uuid[]      NOT NULL CHECK (cardinality(result_ids) > 0),
  result_set_key   text        NOT NULL CHECK (result_set_key ~ '^[0-9a-f]{64}$'),
  -- True when one of the results corrects an earlier released version.
  corrected        boolean     NOT NULL DEFAULT false,
  status           text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'stored', 'failed')),
  -- The stored PDF; the document's id is the archive's id.
  document_id      uuid,
  attempts         integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error       text        CHECK (length(last_error) <= 1000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  stored_at        timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, order_id, result_set_key),
  UNIQUE (order_id, archive_version),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)  REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, order_id)    REFERENCES lab_order (organization_id, id),
  FOREIGN KEY (organization_id, document_id) REFERENCES document (organization_id, id),
  CHECK ((status = 'stored') = (document_id IS NOT NULL AND stored_at IS NOT NULL)),
  CHECK (document_id IS NULL OR document_id = id)
);
CREATE INDEX lab_report_archive_patient_idx ON lab_report_archive (organization_id, patient_id, created_at DESC);
CREATE INDEX lab_report_archive_pending_idx ON lab_report_archive (updated_at) WHERE status = 'pending';

-- A stored archive is final and nothing is deleted; what the report shows never changes.
CREATE FUNCTION lab_report_archive_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'archived laboratory reports are not deleted' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status = 'stored' THEN RAISE EXCEPTION 'a stored laboratory report archive cannot change' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.result_ids <> OLD.result_ids OR NEW.result_set_key <> OLD.result_set_key OR NEW.order_id <> OLD.order_id
     OR NEW.patient_id <> OLD.patient_id OR NEW.archive_version <> OLD.archive_version THEN
    RAISE EXCEPTION 'the content of a laboratory report archive cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_report_archive_immutable BEFORE UPDATE OR DELETE ON lab_report_archive
  FOR EACH ROW EXECUTE FUNCTION lab_report_archive_guard();
