CREATE TABLE app_user (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                          text        NOT NULL DEFAULT 'staff' CHECK (kind IN ('staff', 'patient')),
  email                         text        NOT NULL UNIQUE CHECK (email = lower(email) AND email LIKE '%_@_%'),
  display_name                  text        NOT NULL CHECK (length(btrim(display_name)) > 0),
  password_hash                 text        NOT NULL,
  status                        text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  is_platform_admin             boolean     NOT NULL DEFAULT false,
  mfa_enabled                   boolean     NOT NULL DEFAULT false,
  mfa_secret_encrypted          text,
  mfa_pending_secret_encrypted  text,
  failed_login_count            integer     NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until                  timestamptz,
  password_changed_at           timestamptz NOT NULL DEFAULT now(),
  last_login_at                 timestamptz,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  version                       integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (NOT mfa_enabled OR mfa_secret_encrypted IS NOT NULL)
);

-- Permission catalog. Keys must match the PERMISSIONS constant in libs/auth;
-- the API refuses to start if they drift.
CREATE TABLE permission (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'),
  description  text NOT NULL
);

CREATE TABLE role (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL organization = system role template available to every organization.
  organization_id  uuid        REFERENCES organization (id),
  key              text        NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  name             text        NOT NULL,
  description      text,
  is_system        boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (is_system = (organization_id IS NULL)),
  UNIQUE NULLS NOT DISTINCT (organization_id, key)
);

CREATE TABLE role_permission (
  role_id         uuid NOT NULL REFERENCES role (id),
  permission_key  text NOT NULL REFERENCES permission (key),
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE organization_membership (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  user_id          uuid        NOT NULL REFERENCES app_user (id),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

-- A role granted to a member, optionally narrowed to a facility or department.
-- Revocation is recorded, never deleted.
CREATE TABLE role_assignment (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  user_id          uuid        NOT NULL,
  role_id          uuid        NOT NULL REFERENCES role (id),
  facility_id      uuid,
  department_id    uuid,
  granted_by       uuid        REFERENCES app_user (id),
  granted_at       timestamptz NOT NULL DEFAULT now(),
  revoked_by       uuid        REFERENCES app_user (id),
  revoked_at       timestamptz,
  FOREIGN KEY (organization_id, user_id)     REFERENCES organization_membership (organization_id, user_id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (facility_id, department_id)   REFERENCES department (facility_id, id),
  CHECK (department_id IS NULL OR facility_id IS NOT NULL),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE UNIQUE INDEX role_assignment_active_uq
  ON role_assignment (organization_id, user_id, role_id, facility_id, department_id) NULLS NOT DISTINCT
  WHERE revoked_at IS NULL;
CREATE INDEX role_assignment_user_idx ON role_assignment (user_id) WHERE revoked_at IS NULL;

-- Refresh-token sessions. Only SHA-256 hashes of tokens are stored.
CREATE TABLE auth_session (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                       uuid        NOT NULL REFERENCES app_user (id),
  organization_id               uuid        REFERENCES organization (id),
  refresh_token_hash            text        NOT NULL UNIQUE,
  previous_refresh_token_hash   text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  last_used_at                  timestamptz NOT NULL DEFAULT now(),
  expires_at                    timestamptz NOT NULL,
  revoked_at                    timestamptz,
  revoked_reason                text,
  ip_address                    text,
  user_agent                    text,
  CHECK (expires_at > created_at),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE INDEX auth_session_user_idx ON auth_session (user_id) WHERE revoked_at IS NULL;
CREATE INDEX auth_session_prev_hash_idx ON auth_session (previous_refresh_token_hash) WHERE previous_refresh_token_hash IS NOT NULL;

INSERT INTO permission (key, description) VALUES
  ('organization.read',          'View organization, facilities and departments'),
  ('organization.manage',        'Manage organization settings, facilities and departments'),
  ('user.read',                  'View staff users and their role assignments'),
  ('user.manage',                'Create staff users, grant and revoke roles'),
  ('role.manage',                'Create and edit organization roles'),
  ('patient.search',             'Search the patient index (minimal result fields)'),
  ('patient.read',               'View a patient''s registration record'),
  ('patient.register',           'Register new patients'),
  ('patient.update',             'Update patient demographics, contacts and identifiers'),
  ('patient.consent.manage',     'Record patient consent and communication preferences'),
  ('document.read',              'Download documents'),
  ('document.upload',            'Upload documents'),
  ('document.archive',           'Archive documents'),
  ('notification.send',          'Send notifications to patients and staff'),
  ('notification.read',          'View notification history'),
  ('audit.read',                 'View the audit trail');

INSERT INTO role (key, name, description, is_system) VALUES
  ('org_admin',       'Organization administrator', 'Full administrative access within an organization', true),
  ('physician',       'Physician',                  'Clinical access to patient records',                   true),
  ('nurse',           'Nurse',                      'Clinical support access to patient records',           true),
  ('receptionist',    'Receptionist',               'Front-desk registration and lookup',                   true),
  ('records_officer', 'Medical records officer',    'Maintains patient records and documents',              true),
  ('auditor',         'Auditor',                    'Read-only access to the audit trail',                  true);

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, p.key FROM role r CROSS JOIN permission p WHERE r.key = 'org_admin' AND r.is_system;

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, p.key FROM role r JOIN (VALUES
  ('physician',       'organization.read'), ('physician', 'patient.search'), ('physician', 'patient.read'),
  ('physician',       'patient.register'),  ('physician', 'patient.update'), ('physician', 'patient.consent.manage'),
  ('physician',       'document.read'),     ('physician', 'document.upload'), ('physician', 'notification.read'),
  ('nurse',           'organization.read'), ('nurse', 'patient.search'), ('nurse', 'patient.read'),
  ('nurse',           'patient.register'),  ('nurse', 'patient.update'), ('nurse', 'patient.consent.manage'),
  ('nurse',           'document.read'),     ('nurse', 'document.upload'),
  ('receptionist',    'organization.read'), ('receptionist', 'patient.search'), ('receptionist', 'patient.read'),
  ('receptionist',    'patient.register'),  ('receptionist', 'patient.update'), ('receptionist', 'patient.consent.manage'),
  ('receptionist',    'document.upload'),   ('receptionist', 'notification.send'),
  ('records_officer', 'organization.read'), ('records_officer', 'patient.search'), ('records_officer', 'patient.read'),
  ('records_officer', 'patient.update'),    ('records_officer', 'patient.consent.manage'),
  ('records_officer', 'document.read'),     ('records_officer', 'document.upload'), ('records_officer', 'document.archive'),
  ('auditor',         'organization.read'), ('auditor', 'audit.read')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system
JOIN permission p ON p.key = g.permission_key;
