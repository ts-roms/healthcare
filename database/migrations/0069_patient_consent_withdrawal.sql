-- MyHealth consents: the patient sees their consents and withdraws some of them online. See
-- docs/architecture/portal-app.md ("Privacy and consents").
--
-- A consent decision may be recorded by the patient through their MyHealth account instead of a staff user. MyHealth
-- offers withdrawal only (electronic, effective at once); granting stays at the clinic, which uses the organization's
-- own consent wording. Consents stay append-only (0005).

ALTER TABLE patient_consent
  ALTER COLUMN recorded_by DROP NOT NULL,
  ADD COLUMN recorded_by_portal_account uuid,
  ADD CONSTRAINT patient_consent_portal_account
    FOREIGN KEY (organization_id, recorded_by_portal_account) REFERENCES patient_portal_account (organization_id, id),
  ADD CONSTRAINT patient_consent_one_recorder CHECK ((recorded_by IS NULL) <> (recorded_by_portal_account IS NULL)),
  -- The patient records only withdrawals, electronically.
  ADD CONSTRAINT patient_consent_patient_withdrawal CHECK (
    recorded_by_portal_account IS NULL OR (decision = 'withdrawn' AND captured_via = 'electronic')
  );
