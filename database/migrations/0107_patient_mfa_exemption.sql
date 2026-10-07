-- MyHealth sign-in security (docs/architecture/portal-app.md, "Two-step verification"; D6 phase 2).
--
-- When the clinic requires two-step verification of patients (0100), a patient who cannot use an authenticator app
-- (no smartphone, a disability, a shared phone) would be held at the set-up screen for good. The clinic may exempt
-- one patient's account with a reason, as it exempts integration accounts for staff (0086): the exempt account is
-- never held at the set-up, keeps any two-step verification it already has, and may still turn it on. Who may be
-- exempted, and on what basis, is the organization's own decision (compliance register).

ALTER TABLE patient_portal_account
  ADD COLUMN mfa_exempt_reason text CHECK (mfa_exempt_reason IS NULL OR length(btrim(mfa_exempt_reason)) BETWEEN 3 AND 500),
  ADD COLUMN mfa_exempted_by   uuid REFERENCES app_user (id),
  ADD COLUMN mfa_exempted_at   timestamptz,
  ADD CONSTRAINT patient_portal_account_mfa_exempt_check CHECK (
    (mfa_exempt_reason IS NULL) = (mfa_exempted_by IS NULL) AND (mfa_exempt_reason IS NULL) = (mfa_exempted_at IS NULL)
  );
CREATE INDEX patient_portal_account_mfa_exempt_idx ON patient_portal_account (organization_id) WHERE mfa_exempt_reason IS NOT NULL;
