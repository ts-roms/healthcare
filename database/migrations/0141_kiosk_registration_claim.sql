-- A reviewer claims a kiosk registration while deciding it (docs/security/kiosk-audit-phase-6.md, KA-02).
--
-- Approving registers the patient and may queue them before the submission is closed; two reviewers at once, or a failure
-- part way, must not create a second patient. The first reviewer takes a short claim (the service treats it as expired
-- after two minutes), the second is told the registration is being decided, and a failed attempt releases it.

ALTER TABLE kiosk_registration
  ADD COLUMN claimed_by uuid REFERENCES app_user (id),
  ADD COLUMN claimed_at timestamptz,
  ADD CONSTRAINT kiosk_registration_claim_pair CHECK ((claimed_by IS NULL) = (claimed_at IS NULL));
