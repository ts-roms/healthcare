-- Attendance per clinic: appointments nobody attended marked as no-shows at the end of the day, and patients checking
-- in for an in-person appointment from MyHealth. Both are off until a clinic turns them on.
-- See docs/domains/clinic.md ("Automatic no-shows and online check-in").

ALTER TABLE facility_booking_rule
  -- After this local hour, the day's booked or confirmed appointments that have ended without a check-in are marked
  -- as no-shows by the platform (the same transition, audit and follow-up as a no-show recorded by staff).
  ADD COLUMN auto_no_show            boolean  NOT NULL DEFAULT false,
  ADD COLUMN auto_no_show_hour       smallint NOT NULL DEFAULT 20 CHECK (auto_no_show_hour BETWEEN 12 AND 23),
  -- Patients may check in for an in-person appointment in MyHealth from this long before the start until this long
  -- after it; they join the queue waiting for triage like any other arrival.
  ADD COLUMN online_check_in         boolean  NOT NULL DEFAULT false,
  ADD COLUMN check_in_opens_minutes  integer  NOT NULL DEFAULT 60 CHECK (check_in_opens_minutes BETWEEN 0 AND 240),
  ADD COLUMN check_in_closes_minutes integer  NOT NULL DEFAULT 15 CHECK (check_in_closes_minutes BETWEEN 0 AND 120);

-- A no-show the platform recorded (who last changed the appointment stays as it was: a person or the patient).
ALTER TABLE appointment
  ADD COLUMN no_show_automatic boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT appointment_no_show_automatic_status CHECK (NOT no_show_automatic OR status = 'no_show');

-- Finding the unattended appointments of the last days, per facility.
CREATE INDEX appointment_unattended_idx ON appointment (facility_id, ends_at) WHERE status IN ('booked', 'confirmed');
