-- MyHealth password reset: a patient who forgot the password asks for a link, sent to the account's sign-in email, and
-- chooses a new password with it. See docs/architecture/portal-app.md ("Password reset").
--
-- Only the SHA-256 of the token is stored. A token works once, for a short time, and is refused after a few wrong
-- birth dates; a newer request replaces older ones. The account's email is not verified (email verification is a
-- separate feature), so the patient's date of birth is required as well.

CREATE TABLE patient_portal_password_reset (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  account_id      uuid        NOT NULL,
  token_hash      text        NOT NULL UNIQUE,
  expires_at      timestamptz NOT NULL,
  failed_attempts integer     NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  consumed_at     timestamptz,
  consumed_reason text        CHECK (consumed_reason IN ('reset', 'superseded', 'exhausted', 'account_inactive')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  ip_address      text,
  user_agent      text,
  FOREIGN KEY (organization_id, account_id) REFERENCES patient_portal_account (organization_id, id),
  CHECK ((consumed_at IS NULL) = (consumed_reason IS NULL))
);

CREATE INDEX patient_portal_password_reset_account_idx ON patient_portal_password_reset (account_id, created_at DESC);
