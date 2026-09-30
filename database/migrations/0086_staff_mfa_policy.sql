-- Staff two-step verification policy (docs/security/access-control.md, "Two-step verification policy").
--
-- An organization may require its staff to use two-step verification (TOTP). A member without it can still sign in,
-- but only to set it up: every other route answers 403 mfa_enrollment_required until they do. Accounts that cannot
-- use an authenticator app (the instrument gateway's or another system's integration account) are exempted one by one,
-- with a reason. Administrators can reset a member's two-step verification (a lost phone): the member sets it up again.
-- Policy changes, exemptions and resets are audited with who, when and why.

-- ---- permission ---------------------------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('user.mfa.manage', 'Require two-step verification for staff, exempt integration accounts, and reset a member''s two-step verification');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'user.mfa.manage' FROM role r WHERE r.key = 'org_admin' AND r.is_system;

-- ---- the organization's policy ------------------------------------------------------------------------------

-- One row per organization once it has been set; no row means not required.
CREATE TABLE staff_mfa_policy (
  organization_id  uuid        PRIMARY KEY REFERENCES organization (id),
  required         boolean     NOT NULL,
  updated_by       uuid        NOT NULL REFERENCES app_user (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0)
);

-- ---- exemptions, per membership -----------------------------------------------------------------------------

ALTER TABLE organization_membership
  ADD COLUMN mfa_exempt_reason text,
  ADD COLUMN mfa_exempted_by   uuid REFERENCES app_user (id),
  ADD COLUMN mfa_exempted_at   timestamptz,
  ADD CONSTRAINT organization_membership_mfa_exempt_check CHECK (
    (mfa_exempt_reason IS NULL AND mfa_exempted_by IS NULL AND mfa_exempted_at IS NULL)
    OR (length(btrim(mfa_exempt_reason)) BETWEEN 1 AND 500 AND mfa_exempted_by IS NOT NULL AND mfa_exempted_at IS NOT NULL)
  );
