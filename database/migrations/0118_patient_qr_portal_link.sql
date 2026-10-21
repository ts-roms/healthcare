-- Patient QR codes that start MyHealth activation (docs/domains/patient.md, "Patient QR codes").
--
-- A third thing a code may hold: a link to the organization's MyHealth activation page with the key in the URL
-- fragment (never sent to a server or logged). Scanning it with a phone opens MyHealth with the patient number filled in;
-- the patient still needs their date of birth and the one-time activation code from the clinic, then chooses their own
-- password. The code alone opens nothing.

ALTER TABLE patient_qr_setting DROP CONSTRAINT patient_qr_setting_content_check;
ALTER TABLE patient_qr_setting
  ADD CONSTRAINT patient_qr_setting_content_check CHECK (content IN ('token', 'patient_number', 'portal_link'));

ALTER TABLE patient_qr_code DROP CONSTRAINT patient_qr_code_content_check;
ALTER TABLE patient_qr_code
  ADD CONSTRAINT patient_qr_code_content_check CHECK (content IN ('token', 'patient_number', 'portal_link'));

-- The guard allows only active -> revoked; it never touches content, so it needs no change.
