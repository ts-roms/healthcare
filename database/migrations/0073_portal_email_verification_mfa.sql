-- MyHealth sign-in security: a verified sign-in email and two-step verification (TOTP) for patients.
-- See docs/architecture/portal-app.md ("Email verification", "Two-step verification").
--
-- The sign-in email starts unverified; the patient proves it by entering a code sent to it (and can change it the same
-- way). Two-step verification needs a verified email, so its notices reach a confirmed mailbox. The TOTP secret is
-- sealed with MFA_ENCRYPTION_KEY; recovery codes are stored only as hashes and work once.

ALTER TABLE patient_portal_account
  ADD COLUMN email_verified_at        timestamptz,
  ADD COLUMN mfa_enabled              boolean     NOT NULL DEFAULT false,
  ADD COLUMN mfa_secret_encrypted     text,
  ADD COLUMN mfa_pending_secret_encrypted text,
  ADD COLUMN mfa_enabled_at           timestamptz,
  -- The last accepted TOTP time step: a code cannot be used twice, or an older one after a newer.
  ADD COLUMN mfa_last_used_step       bigint,
  ADD CONSTRAINT patient_portal_account_mfa_secret CHECK (NOT mfa_enabled OR mfa_secret_encrypted IS NOT NULL),
  ADD CONSTRAINT patient_portal_account_mfa_verified_email CHECK (NOT mfa_enabled OR email_verified_at IS NOT NULL);

-- A code sent to an address to prove the patient can read it: the current sign-in email, or a new one being switched to.
CREATE TABLE patient_portal_email_verification (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL,
  account_id      uuid        NOT NULL,
  email           text        NOT NULL CHECK (email = lower(btrim(email)) AND email ~ '^[^@\s]+@[^@\s]+$'),
  -- SHA-256 of "<id>:<code>": a short code is only as strong as its attempt limit, so it lives 15 minutes and 5 tries.
  code_hash       text        NOT NULL,
  expires_at      timestamptz NOT NULL,
  failed_attempts integer     NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  consumed_at     timestamptz,
  consumed_reason text        CHECK (consumed_reason IN ('verified', 'superseded', 'exhausted')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, account_id) REFERENCES patient_portal_account (organization_id, id),
  CHECK ((consumed_at IS NULL) = (consumed_reason IS NULL))
);
CREATE INDEX patient_portal_email_verification_account_idx ON patient_portal_email_verification (account_id, created_at DESC);

-- Single-use codes for signing in without the authenticator app; only hashes are kept.
CREATE TABLE patient_portal_recovery_code (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  account_id      uuid        NOT NULL,
  code_hash       text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  used_at         timestamptz,
  UNIQUE (account_id, code_hash),
  FOREIGN KEY (organization_id, account_id) REFERENCES patient_portal_account (organization_id, id)
);
