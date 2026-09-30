-- Staff two-step verification: codes work once, and recovery codes (docs/security/access-control.md).
--
-- A TOTP code accepted for a sign-in, set-up or change cannot be used again (nor an older one after a newer): the last
-- accepted time step is kept, as MyHealth already does (migration 0073). Recovery codes let staff sign in without their
-- authenticator app; they are shown once when two-step verification is turned on (or renewed), stored only as hashes,
-- and each works once. An administrator's reset, or turning it off, removes them.

ALTER TABLE app_user ADD COLUMN mfa_last_used_step bigint;

CREATE TABLE staff_recovery_code (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES app_user (id),
  code_hash   text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  used_at     timestamptz,
  UNIQUE (user_id, code_hash)
);
CREATE INDEX staff_recovery_code_unused_idx ON staff_recovery_code (user_id) WHERE used_at IS NULL;
