-- Single-use short-lived tokens (docs/security/zero-trust-audit-2026-11-06.md, low findings; docs/security/access-control.md).
--
-- The sign-in challenge between the password and the second step (5 minutes) and the live-update ticket (60 seconds)
-- are signed tokens that could be replayed within their lifetime. Each is now spent once: its SHA-256 is recorded here
-- when it is used (a challenge when the second step succeeds, a ticket when its socket opens), and a second use is
-- refused. Only the hash is kept, never the token; rows are deleted once the token has expired. No organization:
-- a token is spent before, or regardless of, the organization it belongs to.

CREATE TABLE consumed_token (
  token_hash  text        PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  kind        text        NOT NULL CHECK (kind IN ('staff_mfa_challenge', 'staff_realtime_ticket', 'patient_mfa_challenge', 'patient_realtime_ticket')),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consumed_token_expiry ON consumed_token (expires_at);
