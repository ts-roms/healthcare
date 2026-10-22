-- Offer MyHealth access at registration as the organization's default (docs/domains/patient.md, "Patient QR codes").
-- When on, the registration form starts with "Give MyHealth access now" ticked: the registering person confirms the patient
-- agreed, the portal access consent is recorded and an activation code is issued (shown once). Never recorded without
-- that confirmation; the registering person may untick it for one patient.
ALTER TABLE patient_qr_setting ADD COLUMN invite_at_registration boolean NOT NULL DEFAULT false;
