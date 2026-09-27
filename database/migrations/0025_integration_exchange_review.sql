-- Integration exchanges: operator review (Phase 8). See docs/architecture/integration-worker.md.
--
-- Exchanges that ended without success (failed, rejected, not configured) need a person to look at them: fix the
-- cause and prepare the request again from its source (invoice, case report, patient record), or record that nothing
-- more is needed. The review is recorded on the exchange; the exchange's own outcome never changes.

ALTER TABLE integration_exchange
  ADD COLUMN resolved_at      timestamptz,
  ADD COLUMN resolved_by      uuid REFERENCES app_user (id),
  ADD COLUMN resolution_note  text CHECK (length(btrim(resolution_note)) BETWEEN 3 AND 500),
  ADD CONSTRAINT integration_exchange_resolution CHECK (
    (resolved_at IS NULL AND resolved_by IS NULL AND resolution_note IS NULL)
    OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_note IS NOT NULL
        AND status IN ('failed', 'rejected', 'not_configured'))
  );

CREATE INDEX integration_exchange_attention ON integration_exchange (organization_id, requested_at DESC)
  WHERE status IN ('failed', 'rejected', 'not_configured') AND resolved_at IS NULL;

INSERT INTO permission (key, description) VALUES
  ('integration.exchange.manage', 'Review outbound integration exchanges: see failures, re-queue stalled ones, record a resolution');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'integration.exchange.manage' FROM role r
WHERE r.key = 'org_admin' AND r.is_system
ON CONFLICT DO NOTHING;
