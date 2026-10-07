-- MyHealth sign-in security (docs/architecture/portal-app.md, "Passkeys"; D6 phase 3).
--
-- A passkey (WebAuthn) is a third way to answer the second step of signing in, beside a code from the authenticator
-- app and a recovery code. It is added on top of two-step verification with the app, which stays the fallback for a
-- lost or replaced phone, so `mfa_enabled`, the clinic's requirement, its exemptions and the recovery codes keep their
-- meaning. A passkey belongs to MyHealth's address (PORTAL_BASE_URL): its relying-party ID is that host.
--
-- Only the public key is stored. Credential ids and keys are base64url text. Every challenge works once, for five
-- minutes, and is stored only as its SHA-256. Turning two-step verification off, or the clinic resetting it, removes
-- every passkey (kept as history, never deleted).

CREATE TABLE patient_passkey (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  account_id       uuid        NOT NULL,
  credential_id    text        NOT NULL UNIQUE CHECK (credential_id ~ '^[A-Za-z0-9_-]+$' AND length(credential_id) BETWEEN 16 AND 1400),
  public_key       text        NOT NULL CHECK (public_key ~ '^[A-Za-z0-9_-]+$' AND length(public_key) BETWEEN 16 AND 4000),
  -- The authenticator's signature counter at the last use; a counter that goes backwards is refused (possible clone).
  sign_count       bigint      NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  transports       text[]      NOT NULL DEFAULT '{}',
  -- Whether the passkey can be synced to the patient's other devices (as the authenticator reported it).
  backed_up        boolean     NOT NULL DEFAULT false,
  -- A name the patient chose, or one derived from the browser ("Chrome on Android"); never the full user agent.
  label            text        NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_used_at     timestamptz,
  revoked_at       timestamptz,
  revoked_reason   text        CHECK (revoked_reason IN ('removed_by_patient', 'mfa_disabled', 'mfa_reset')),
  FOREIGN KEY (organization_id, account_id) REFERENCES patient_portal_account (organization_id, id),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE INDEX patient_passkey_account_idx ON patient_passkey (account_id) WHERE revoked_at IS NULL;

CREATE TABLE patient_passkey_challenge (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  account_id       uuid        NOT NULL,
  purpose          text        NOT NULL CHECK (purpose IN ('register', 'sign_in')),
  challenge_hash   text        NOT NULL UNIQUE CHECK (challenge_hash ~ '^[0-9a-f]{64}$'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  used_at          timestamptz,
  FOREIGN KEY (organization_id, account_id) REFERENCES patient_portal_account (organization_id, id),
  CHECK (expires_at > created_at)
);
CREATE INDEX patient_passkey_challenge_account_idx ON patient_passkey_challenge (account_id, purpose) WHERE used_at IS NULL;
