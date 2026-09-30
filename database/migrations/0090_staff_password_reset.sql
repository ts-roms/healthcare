-- Staff reset a forgotten password through a single-use link emailed to their sign-in address.
-- See docs/security/access-control.md ("Password reset by email").

-- A reset link: only the hash of its random token is kept; it works once, for a short time. With two-step verification
-- on, choosing the new password also needs a current code; wrong codes burn the link.
CREATE TABLE staff_password_reset (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES app_user (id),
  token_hash      text        NOT NULL UNIQUE,
  expires_at      timestamptz NOT NULL,
  failed_attempts integer     NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  consumed_at     timestamptz,
  consumed_reason text        CHECK (consumed_reason IN ('reset', 'superseded', 'exhausted', 'account_inactive')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  ip_address      text,
  user_agent      text,
  CHECK ((consumed_at IS NULL) = (consumed_reason IS NULL))
);

CREATE INDEX staff_password_reset_user_idx ON staff_password_reset (user_id, created_at DESC);
