-- Scheduling (docs/domains/clinic.md, "Online booking rules and the waiting list"; "Rooms"): waiting-list rules per
-- visit type or practitioner, and offers from the waiting list that a patient accepts — never a booking nobody agreed to.
--
-- 1. Waiting-list rules. The facility's rule (`facility_booking_rule.waitlist_enabled`, `max_waitlist_entries`) stays the
--    default; a rule for one visit type or one practitioner at the facility overrides it, the most specific first
--    (practitioner over visit type over facility). Versioned configuration, audited.
-- 2. Offers. Where a facility chooses the `offer` mode, a time that opens (a cancellation, or a visit moved away) is
--    offered to the first matching entries in priority order: an offer holds the exact slot for a while; the patient
--    accepts it in MyHealth, or staff accept it for them after speaking to them; the first acceptance books through the
--    ordinary booking commands (lead time, limits and the exclusion constraints all apply) and the others learn the time
--    is taken. An offer not accepted in time expires and the slot goes to the next entries. In `notice` mode (the
--    default) the existing content-free "a time may have opened" message is sent instead. Fully automatic booking
--    without the patient's acceptance is deliberately not built.
-- Rooms need no schema: appointments and schedule blocks already carry a room (0009); views read them.

-- ---- facility rule: the waiting-list mode -----------------------------------------------------------------------

ALTER TABLE facility_booking_rule
  ADD COLUMN waitlist_mode        text    NOT NULL DEFAULT 'notice' CHECK (waitlist_mode IN ('notice', 'offer')),
  -- How long an offered time is held for the patient before it goes to the next entries.
  ADD COLUMN offer_hold_minutes   integer NOT NULL DEFAULT 120 CHECK (offer_hold_minutes BETWEEN 15 AND 1440),
  -- How many entries one opened time is offered to at once (first acceptance wins).
  ADD COLUMN offer_batch          integer NOT NULL DEFAULT 1 CHECK (offer_batch BETWEEN 1 AND 5);

-- ---- waiting-list rules per visit type or practitioner -----------------------------------------------------------

CREATE TABLE waitlist_rule (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  facility_id      uuid        NOT NULL,
  scope            text        NOT NULL CHECK (scope IN ('visit_type', 'practitioner')),
  visit_type_id    uuid,
  practitioner_id  uuid,
  -- Patients may join the waiting list for this visit type / practitioner at this facility.
  enabled          boolean     NOT NULL,
  max_entries      integer     NOT NULL CHECK (max_entries BETWEEN 1 AND 10),
  -- How far ahead a request may reach; the facility's horizon when null.
  max_days_ahead   integer     CHECK (max_days_ahead BETWEEN 1 AND 365),
  updated_by       uuid        NOT NULL REFERENCES app_user (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id)     REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, visit_type_id)   REFERENCES visit_type (organization_id, id),
  FOREIGN KEY (organization_id, practitioner_id) REFERENCES practitioner (organization_id, id),
  CHECK ((scope = 'visit_type') = (visit_type_id IS NOT NULL)),
  CHECK ((scope = 'practitioner') = (practitioner_id IS NOT NULL))
);
-- One rule per visit type and per practitioner at a facility.
CREATE UNIQUE INDEX waitlist_rule_visit_type_uq ON waitlist_rule (facility_id, visit_type_id) WHERE scope = 'visit_type';
CREATE UNIQUE INDEX waitlist_rule_practitioner_uq ON waitlist_rule (facility_id, practitioner_id) WHERE scope = 'practitioner';

-- ---- offers from the waiting list --------------------------------------------------------------------------------

-- Offers refer to entries of the same organization (0009 gave the entry no composite key).
ALTER TABLE appointment_waitlist_entry ADD CONSTRAINT appointment_waitlist_entry_organization_id_id_key UNIQUE (organization_id, id);

CREATE TABLE waitlist_offer (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  facility_id      uuid        NOT NULL,
  entry_id         uuid        NOT NULL,
  patient_id       uuid        NOT NULL,
  practitioner_id  uuid        NOT NULL,
  visit_type_id    uuid        NOT NULL,
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  -- The facility's local day of the offered time (one offer per entry and day).
  offered_for      date        NOT NULL,
  expires_at       timestamptz NOT NULL,
  status           text        NOT NULL DEFAULT 'offered' CHECK (status IN ('offered', 'accepted', 'declined', 'expired', 'withdrawn', 'taken')),
  appointment_id   uuid,
  -- Who accepted: the patient in MyHealth (no staff user) or a staff member for them.
  accepted_by      uuid        REFERENCES app_user (id),
  accepted_by_patient boolean  NOT NULL DEFAULT false,
  withdrawn_by     uuid        REFERENCES app_user (id),
  withdraw_reason  text        CHECK (length(btrim(withdraw_reason)) BETWEEN 3 AND 500),
  created_at       timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (entry_id, offered_for),
  FOREIGN KEY (organization_id, facility_id)     REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, entry_id)        REFERENCES appointment_waitlist_entry (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)      REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, practitioner_id) REFERENCES practitioner (organization_id, id),
  FOREIGN KEY (organization_id, visit_type_id)   REFERENCES visit_type (organization_id, id),
  FOREIGN KEY (patient_id, appointment_id)       REFERENCES appointment (patient_id, id),
  CHECK (ends_at > starts_at),
  CHECK ((status = 'accepted') = (appointment_id IS NOT NULL)),
  CHECK ((status = 'offered') = (closed_at IS NULL)),
  CHECK (status <> 'withdrawn' OR withdraw_reason IS NOT NULL),
  CHECK (NOT accepted_by_patient OR accepted_by IS NULL)
);
CREATE INDEX waitlist_offer_open_idx ON waitlist_offer (facility_id, expires_at) WHERE status = 'offered';
CREATE INDEX waitlist_offer_patient_idx ON waitlist_offer (patient_id, created_at DESC);
CREATE INDEX waitlist_offer_slot_idx ON waitlist_offer (practitioner_id, starts_at) WHERE status = 'offered';
