-- Integration worker (Phase 8). See docs/architecture/integration-worker.md.
--
-- The API prepares an outbound payload (it can read the domains); apps/integration-worker sends it (it cannot).
-- The prepared payload is handed over here, encrypted with AES-256-GCM (INTEGRATION_PAYLOAD_KEY), and deleted as soon
-- as the exchange reaches a final status. The BullMQ job carries only the exchange id, so no PHI sits in Redis.

CREATE TABLE integration_exchange_payload (
  exchange_id      uuid        PRIMARY KEY REFERENCES integration_exchange (id),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  -- "v1.<iv>.<tag>.<ciphertext>" (base64url); the exchange's payload_digest is the SHA-256 of the plaintext.
  ciphertext       text        NOT NULL CHECK (ciphertext LIKE 'v1.%'),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- When the worker last picked the exchange up, to find exchanges whose queue job was lost.
ALTER TABLE integration_exchange ADD COLUMN last_attempt_at timestamptz;
CREATE INDEX integration_exchange_queued ON integration_exchange (requested_at) WHERE status = 'queued';
