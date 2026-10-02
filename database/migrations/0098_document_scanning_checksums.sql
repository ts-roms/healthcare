-- Documents (docs/domains/documents.md): malware scanning and checksums (D7 phase 1).
--
-- Every upload is read back from object storage when its upload is completed, hashed (SHA-256) and, where a scanner
-- is configured (CLAMAV_HOST), scanned before it becomes available. An infected file is recorded as `quarantined`:
-- never `available`, so nothing that attaches, lists or serves available documents ever reaches it; the object stays
-- in storage for the organization's incident handling (nothing is deleted). Without a scanner the document becomes
-- available with `scan_status = 'not_scanned'`, which the readiness probe and the lists make visible. Documents the
-- platform generated itself never came from outside and are marked clean by origin.

ALTER TABLE document
  DROP CONSTRAINT document_status_check,
  ADD CONSTRAINT document_status_check CHECK (status IN ('pending_upload', 'available', 'archived', 'quarantined')),
  -- not_scanned: no scanner was configured when the upload was completed; clean / quarantined: the scanner's verdict.
  ADD COLUMN scan_status     text CHECK (scan_status IN ('not_scanned', 'clean', 'quarantined')),
  -- The scanner's signature name for a quarantined file (never clinical text).
  ADD COLUMN scan_signature  text CHECK (scan_signature IS NULL OR length(btrim(scan_signature)) BETWEEN 1 AND 200),
  ADD COLUMN scanned_at      timestamptz,
  -- SHA-256 of the stored bytes, hex, recorded at completion or generation; null for documents stored before 0098.
  ADD COLUMN sha256          text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  -- A checksum the uploader declared at registration; completion refuses a mismatch.
  ADD COLUMN declared_sha256 text CHECK (declared_sha256 IS NULL OR declared_sha256 ~ '^[0-9a-f]{64}$');

-- Rows stored before scanning existed: generated documents are the platform's own; uploads were never scanned.
UPDATE document SET scan_status = CASE WHEN source = 'generated' THEN 'clean' ELSE 'not_scanned' END, scanned_at = uploaded_at
  WHERE status <> 'pending_upload';

ALTER TABLE document
  -- A completed document has a verdict (or the note that none was possible); a pending one has none.
  ADD CONSTRAINT document_scan_verdict_check CHECK ((status = 'pending_upload') = (scan_status IS NULL)),
  ADD CONSTRAINT document_quarantine_check CHECK ((status = 'quarantined') = (scan_status = 'quarantined')),
  ADD CONSTRAINT document_quarantine_signature_check CHECK (scan_signature IS NULL OR scan_status = 'quarantined'),
  ADD CONSTRAINT document_scanned_at_check CHECK ((scan_status IS NULL) = (scanned_at IS NULL));

CREATE INDEX document_quarantined_idx ON document (organization_id, scanned_at DESC) WHERE status = 'quarantined';
