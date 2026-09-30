-- MyHealth communication preferences: the patient chooses, per channel and kind of message, what the clinic may send.
-- See docs/architecture/portal-app.md ("Notification settings").
--
-- A preference may be set by the patient's MyHealth account instead of a staff user. The row keeps who set it last;
-- the audit trail keeps every change.

ALTER TABLE patient_communication_preference
  ALTER COLUMN updated_by DROP NOT NULL,
  ADD COLUMN updated_by_portal_account uuid,
  ADD CONSTRAINT patient_communication_preference_portal_account
    FOREIGN KEY (organization_id, updated_by_portal_account) REFERENCES patient_portal_account (organization_id, id),
  ADD CONSTRAINT patient_communication_preference_one_recorder CHECK ((updated_by IS NULL) <> (updated_by_portal_account IS NULL));
