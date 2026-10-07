-- Documents (docs/domains/documents.md): integrity review of stored documents against their checksums (D7 phase 2).
--
-- Migration 0098 records the SHA-256 of every document's bytes when it is stored. A review run, started by the
-- records office, reads each completed document back from object storage and compares the bytes with that hash:
-- corruption, a failed restore or tampering shows up as a mismatch; an object that is gone shows up as missing. A
-- document stored before 0098 has no hash: the run records the current hash as its baseline (reported separately,
-- never counted as verified) so the next run can verify it. A mismatched or missing document is refused to every
-- reader until the records office resolves the finding with a note; nothing is repaired, replaced or deleted.

ALTER TABLE document
  -- The latest outcome of a review, or null while never reviewed.
  ADD COLUMN integrity_status     text CHECK (integrity_status IN ('verified', 'baselined', 'mismatch', 'missing', 'unreadable')),
  ADD COLUMN integrity_checked_at timestamptz,
  ADD CONSTRAINT document_integrity_checked_check CHECK ((integrity_status IS NULL) = (integrity_checked_at IS NULL));

CREATE TABLE document_integrity_run (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organization (id),
  -- One document category, or every category when null.
  category        text,
  status          text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  -- Documents read so far, by outcome. Baselined documents had no recorded hash (stored before 0098).
  checked         integer     NOT NULL DEFAULT 0 CHECK (checked >= 0),
  verified        integer     NOT NULL DEFAULT 0 CHECK (verified >= 0),
  baselined       integer     NOT NULL DEFAULT 0 CHECK (baselined >= 0),
  mismatched      integer     NOT NULL DEFAULT 0 CHECK (mismatched >= 0),
  missing         integer     NOT NULL DEFAULT 0 CHECK (missing >= 0),
  unreadable      integer     NOT NULL DEFAULT 0 CHECK (unreadable >= 0),
  -- Where a run interrupted (e.g. an API restart) resumes: the last document checked, in id order.
  cursor_document_id uuid,
  attempts        integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error      text        CHECK (length(last_error) <= 2000),
  requested_by    uuid        NOT NULL REFERENCES app_user (id),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  heartbeat_at    timestamptz,
  completed_at    timestamptz,
  cancelled_by    uuid        REFERENCES app_user (id),
  CHECK (checked = verified + baselined + mismatched + missing + unreadable),
  CHECK ((status IN ('completed', 'failed', 'cancelled')) = (completed_at IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_by IS NOT NULL)),
  UNIQUE (organization_id, id)
);
-- One run at a time per organization.
CREATE UNIQUE INDEX document_integrity_run_one_open ON document_integrity_run (organization_id) WHERE status IN ('queued', 'running');
CREATE INDEX document_integrity_run_recent ON document_integrity_run (organization_id, requested_at DESC);
CREATE INDEX document_integrity_run_pending ON document_integrity_run (requested_at) WHERE status IN ('queued', 'running');

-- A document whose bytes did not verify in a run. Resolved once, with a note, by the records office; never deleted.
CREATE TABLE document_integrity_finding (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organization (id),
  run_id          uuid        NOT NULL,
  document_id     uuid        NOT NULL,
  outcome         text        NOT NULL CHECK (outcome IN ('mismatch', 'missing', 'unreadable')),
  -- The hash on record and the hash of the bytes found (null when the object was missing or could not be read).
  recorded_sha256 text        CHECK (recorded_sha256 IS NULL OR recorded_sha256 ~ '^[0-9a-f]{64}$'),
  computed_sha256 text        CHECK (computed_sha256 IS NULL OR computed_sha256 ~ '^[0-9a-f]{64}$'),
  found_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by     uuid        REFERENCES app_user (id),
  resolution_note text        CHECK (resolution_note IS NULL OR length(btrim(resolution_note)) BETWEEN 5 AND 500),
  FOREIGN KEY (organization_id, run_id) REFERENCES document_integrity_run (organization_id, id),
  FOREIGN KEY (organization_id, document_id) REFERENCES document (organization_id, id),
  CHECK ((resolved_at IS NULL) = (resolved_by IS NULL) AND (resolved_at IS NULL) = (resolution_note IS NULL)),
  CHECK (outcome <> 'mismatch' OR (recorded_sha256 IS NOT NULL AND computed_sha256 IS NOT NULL AND recorded_sha256 <> computed_sha256))
);
-- One open finding per document: a run over a document still unresolved adds nothing.
CREATE UNIQUE INDEX document_integrity_finding_open ON document_integrity_finding (document_id) WHERE resolved_at IS NULL;
CREATE INDEX document_integrity_finding_org_open ON document_integrity_finding (organization_id, found_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX document_integrity_finding_org_resolved ON document_integrity_finding (organization_id, resolved_at DESC) WHERE resolved_at IS NOT NULL;
CREATE INDEX document_integrity_finding_run_idx ON document_integrity_finding (run_id);

-- A finding is resolved once and never deleted: only the resolution columns of an open finding may change.
CREATE OR REPLACE FUNCTION document_integrity_finding_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'document_integrity_finding rows are never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'A resolved integrity finding never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.run_id <> OLD.run_id OR NEW.document_id <> OLD.document_id
     OR NEW.outcome <> OLD.outcome OR NEW.recorded_sha256 IS DISTINCT FROM OLD.recorded_sha256
     OR NEW.computed_sha256 IS DISTINCT FROM OLD.computed_sha256 OR NEW.found_at <> OLD.found_at THEN
    RAISE EXCEPTION 'Only the resolution of an integrity finding may be recorded' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER document_integrity_finding_guard BEFORE UPDATE OR DELETE ON document_integrity_finding
  FOR EACH ROW EXECUTE FUNCTION document_integrity_finding_guard();

INSERT INTO permission (key, description) VALUES
  ('document.integrity.manage', 'Run the integrity review of stored documents against their checksums and resolve what it finds');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('org_admin', 'document.integrity.manage'),
  ('records_officer', 'document.integrity.manage')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system
ON CONFLICT DO NOTHING;
