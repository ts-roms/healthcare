-- Patient portal accounts (CLAUDE.md §17).
--
-- Patients are not staff users: they get their own identity and sessions.
-- An account starts "invited" (front desk issues a one-time activation code
-- after verifying the patient in person and recording portal_access consent),
-- becomes "active" when the patient sets a login email and password, and can
-- be "disabled" by staff. One account per patient per organization.

CREATE TABLE patient_portal_account (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid        NOT NULL REFERENCES organization (id),
  patient_id             uuid        NOT NULL,
  status                 text        NOT NULL CHECK (status IN ('invited', 'active', 'disabled')),
  email                  text        CHECK (email = lower(btrim(email)) AND email ~ '^[^@\s]+@[^@\s]+$'),
  password_hash          text,
  activation_code_hash   text,
  activation_expires_at  timestamptz,
  failed_attempts        integer     NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until           timestamptz,
  invited_by             uuid        NOT NULL REFERENCES app_user (id),
  invited_at             timestamptz NOT NULL DEFAULT now(),
  activated_at           timestamptz,
  last_login_at          timestamptz,
  disabled_at            timestamptz,
  disabled_by            uuid        REFERENCES app_user (id),
  disabled_reason        text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  version                integer     NOT NULL DEFAULT 1,
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id),
  UNIQUE (organization_id, patient_id),
  UNIQUE (organization_id, email),
  UNIQUE (organization_id, id),
  CHECK (status <> 'active' OR (email IS NOT NULL AND password_hash IS NOT NULL AND activated_at IS NOT NULL)),
  CHECK (status <> 'invited' OR (activation_code_hash IS NOT NULL AND activation_expires_at IS NOT NULL)),
  CHECK ((status = 'disabled') = (disabled_at IS NOT NULL AND disabled_by IS NOT NULL AND disabled_reason IS NOT NULL))
);

CREATE TABLE patient_portal_session (
  id                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id              uuid        NOT NULL,
  account_id                   uuid        NOT NULL,
  refresh_token_hash           text        NOT NULL UNIQUE,
  previous_refresh_token_hash  text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  last_used_at                 timestamptz NOT NULL DEFAULT now(),
  expires_at                   timestamptz NOT NULL,
  revoked_at                   timestamptz,
  revoked_reason               text,
  ip_address                   text,
  user_agent                   text,
  FOREIGN KEY (organization_id, account_id) REFERENCES patient_portal_account (organization_id, id),
  CHECK (expires_at > created_at),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE INDEX patient_portal_session_account_idx ON patient_portal_session (account_id) WHERE revoked_at IS NULL;
CREATE INDEX patient_portal_session_prev_hash_idx ON patient_portal_session (previous_refresh_token_hash)
  WHERE previous_refresh_token_hash IS NOT NULL;

INSERT INTO permission (key, description) VALUES
  ('patient.portal.manage', 'Invite patients to the patient portal and disable portal accounts');

-- Organization administrators hold every permission.
INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, p.key FROM role r CROSS JOIN permission p
WHERE r.key = 'org_admin' AND r.is_system
ON CONFLICT DO NOTHING;

-- Front desk and records staff enroll patients (they verify identity in person).
INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'patient.portal.manage' FROM role r
WHERE r.key IN ('receptionist', 'records_officer') AND r.is_system;
