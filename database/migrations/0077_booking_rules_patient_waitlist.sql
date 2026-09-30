-- Per-clinic online booking rules and a patient waiting list for full days.
-- See docs/domains/clinic.md ("Online booking rules and the waiting list").
--
-- A facility without a row keeps the platform's defaults (2 hours' notice, 60 days ahead, 3 upcoming online bookings,
-- changes until 2 hours before, no patient waiting list), so nothing changes until a clinic sets its own.

CREATE TABLE facility_booking_rule (
  facility_id            uuid        PRIMARY KEY REFERENCES facility (id),
  organization_id        uuid        NOT NULL,
  -- How long before the start a patient may still book online.
  min_lead_minutes       integer     NOT NULL DEFAULT 120 CHECK (min_lead_minutes BETWEEN 0 AND 10080),
  -- How far ahead patients may book.
  max_advance_days       integer     NOT NULL DEFAULT 60 CHECK (max_advance_days BETWEEN 1 AND 365),
  -- Upcoming self-booked appointments one patient may hold at this facility's rule.
  max_upcoming           integer     NOT NULL DEFAULT 3 CHECK (max_upcoming BETWEEN 1 AND 20),
  -- Patients may cancel or move an appointment online until this long before the start.
  change_cutoff_minutes  integer     NOT NULL DEFAULT 120 CHECK (change_cutoff_minutes BETWEEN 0 AND 10080),
  -- Patients may ask to be told when a time opens on a day with no open times. The clinic works the list.
  waitlist_enabled       boolean     NOT NULL DEFAULT false,
  max_waitlist_entries   integer     NOT NULL DEFAULT 3 CHECK (max_waitlist_entries BETWEEN 1 AND 10),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid        NOT NULL REFERENCES app_user (id),
  version                integer     NOT NULL DEFAULT 1,
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id)
);

-- A waiting-list entry may be made by the patient in MyHealth instead of a staff user.
ALTER TABLE appointment_waitlist_entry
  ALTER COLUMN created_by DROP NOT NULL,
  ADD COLUMN created_by_patient boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT appointment_waitlist_entry_one_creator CHECK ((created_by IS NULL) = created_by_patient);

-- Finding the entries a freed time may suit.
CREATE INDEX appointment_waitlist_entry_open_idx ON appointment_waitlist_entry (facility_id, earliest_date, latest_date) WHERE status = 'waiting';
