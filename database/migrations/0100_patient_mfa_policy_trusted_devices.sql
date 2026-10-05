-- MyHealth sign-in security (docs/architecture/portal-app.md, "Two-step verification"; D6 phase 1).
--
-- 1. An organization may require two-step verification for patients (`patient_mfa_policy`), from a date it chooses so
--    patients are warned first. As for staff (0086), nobody is locked out: from that date a patient without it still
--    signs in, but every portal route except sign-out, the profile and the email and two-step set-up routes answers
--    403 mfa_enrollment_required until it is on.
-- 2. Trusted devices (`patient_trusted_device`): after a correct second-step code the patient may ask not to be asked
--    again on that browser for 30 days. The browser keeps a random token (httpOnly cookie); only its hash is stored.
--    At most five per account; all forgotten when two-step verification is turned off or reset, or every session is
--    ended (password reset, account disabled).

CREATE TABLE patient_mfa_policy (
  organization_id  uuid        PRIMARY KEY REFERENCES organization (id),
  required         boolean     NOT NULL,
  -- The local date from which patients without two-step verification can only set it up; null = at once.
  required_from    date,
  updated_by       uuid        NOT NULL REFERENCES app_user (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (required OR required_from IS NULL)
);

CREATE TABLE patient_trusted_device (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  account_id       uuid        NOT NULL,
  token_hash       text        NOT NULL UNIQUE,
  -- A short description derived from the browser's user agent ("Chrome on Android"), never the full string.
  label            text        NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_used_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  revoked_reason   text        CHECK (revoked_reason IN ('forgotten_by_patient', 'forgotten_all', 'replaced', 'mfa_disabled', 'mfa_reset', 'sessions_ended')),
  FOREIGN KEY (organization_id, account_id) REFERENCES patient_portal_account (organization_id, id),
  CHECK (expires_at > created_at),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE INDEX patient_trusted_device_account_idx ON patient_trusted_device (account_id) WHERE revoked_at IS NULL;
