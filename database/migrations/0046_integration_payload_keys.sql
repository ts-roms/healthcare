-- Integration payload key rotation. See docs/architecture/integration-worker.md.
--
-- Prepared payloads handed to the integration worker are sealed with AES-256-GCM. They are now sealed with the
-- current key of a key ring (INTEGRATION_PAYLOAD_KEYS / INTEGRATION_PAYLOAD_KEY_ID) and tagged with its id, so a key
-- can be rotated while exchanges are still queued: the worker opens each payload with the key it names.
--   * "v1.<iv>.<tag>.<ciphertext>" — sealed before key ids existed (key_id NULL); the worker tries each configured key.
--   * "v2.<key id>.<iv>.<tag>.<ciphertext>" — key_id repeats the id in the header, so operators can see which keys
--     queued payloads still need before removing one (SELECT key_id, count(*) FROM integration_exchange_payload GROUP BY 1).

ALTER TABLE integration_exchange_payload ADD COLUMN key_id text;
ALTER TABLE integration_exchange_payload DROP CONSTRAINT integration_exchange_payload_ciphertext_check;
ALTER TABLE integration_exchange_payload ADD CONSTRAINT integration_exchange_payload_sealed_format CHECK (
  (key_id IS NULL AND ciphertext LIKE 'v1.%')
  OR (key_id ~ '^[A-Za-z0-9_-]{1,40}$' AND ciphertext LIKE 'v2.%' AND split_part(ciphertext, '.', 2) = key_id)
);
