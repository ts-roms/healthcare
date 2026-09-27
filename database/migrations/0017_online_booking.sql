-- Online booking from MyHealth (Phase 4b). See docs/architecture/portal-app.md.
--
-- Patients book, reschedule and cancel their own appointments. No staff user is involved, so the
-- "by" columns stay empty and the patient is recorded instead; the audit trail records the patient
-- (actor type "patient") as for every portal action.

-- Which visit types patients may book themselves (off unless the clinic turns it on).
ALTER TABLE visit_type ADD COLUMN online_booking boolean NOT NULL DEFAULT false;
ALTER TABLE visit_type ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

ALTER TABLE appointment ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE appointment ALTER COLUMN updated_by DROP NOT NULL;
-- Who made the booking, and who last changed it (e.g. a patient's cancellation or reschedule).
ALTER TABLE appointment ADD COLUMN booked_by_patient boolean NOT NULL DEFAULT false;
ALTER TABLE appointment ADD COLUMN updated_by_patient boolean NOT NULL DEFAULT false;
ALTER TABLE appointment ADD CONSTRAINT appointment_created_by_known
  CHECK ((created_by IS NOT NULL) <> booked_by_patient);
ALTER TABLE appointment ADD CONSTRAINT appointment_patient_booking_online
  CHECK (NOT booked_by_patient OR booking_channel = 'online');
ALTER TABLE appointment ADD CONSTRAINT appointment_updated_by_known
  CHECK ((updated_by IS NOT NULL) <> updated_by_patient);
