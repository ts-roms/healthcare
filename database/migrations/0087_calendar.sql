-- Staff calendar (docs/domains/calendar.md): meetings, events, blocked time, trainings and reminders of a facility,
-- shown beside the facility's appointments (which stay in the appointment tables — the calendar only reads them).
--
-- An event belongs to one facility. Its organizer changes or cancels it (or anyone with clinic.configure); a
-- cancelled event stays listed, marked, with its reason — nothing is deleted. Attendees are the organization's
-- clinicians (practitioners linked to a user): an event visible to 'invitees' is seen only by the organizer and the
-- attendees, a 'facility' event by everyone with calendar.read at the facility. No patient data belongs in an event.

INSERT INTO permission (key, description) VALUES
  ('calendar.read',   'View the facility calendar (meetings, events and blocked time) beside appointments'),
  ('calendar.manage', 'Add calendar events, change or cancel one''s own, and invite clinicians');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('org_admin', 'calendar.read'), ('org_admin', 'calendar.manage'),
  ('physician', 'calendar.read'), ('physician', 'calendar.manage'),
  ('nurse', 'calendar.read'), ('nurse', 'calendar.manage'),
  ('dentist', 'calendar.read'), ('dentist', 'calendar.manage'),
  ('dental_assistant', 'calendar.read'),
  ('receptionist', 'calendar.read'), ('receptionist', 'calendar.manage'),
  ('records_officer', 'calendar.read')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system
ON CONFLICT DO NOTHING;

CREATE TABLE calendar_event (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  facility_id      uuid        NOT NULL,
  title            text        NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
  kind             text        NOT NULL CHECK (kind IN ('meeting', 'event', 'blocked', 'training', 'reminder')),
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  -- All-day events cover whole days of the facility's time zone (starts_at/ends_at are their bounds).
  all_day          boolean     NOT NULL DEFAULT false,
  location         text        CHECK (length(btrim(location)) BETWEEN 1 AND 200),
  description      text        CHECK (length(btrim(description)) BETWEEN 1 AND 2000),
  visibility       text        NOT NULL DEFAULT 'facility' CHECK (visibility IN ('facility', 'invitees')),
  status           text        NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  organizer_user_id uuid       NOT NULL REFERENCES app_user (id),
  organizer_name   text        NOT NULL,
  cancel_reason    text        CHECK (length(btrim(cancel_reason)) BETWEEN 3 AND 500),
  cancelled_by     uuid        REFERENCES app_user (id),
  cancelled_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid        NOT NULL REFERENCES app_user (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '31 days'),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK ((cancelled_at IS NULL) = (cancelled_by IS NULL) AND (cancelled_at IS NULL) = (cancel_reason IS NULL))
);
CREATE INDEX calendar_event_facility_time ON calendar_event (organization_id, facility_id, starts_at, ends_at);

CREATE TABLE calendar_event_attendee (
  event_id         uuid        NOT NULL,
  organization_id  uuid        NOT NULL,
  user_id          uuid        NOT NULL REFERENCES app_user (id),
  PRIMARY KEY (event_id, user_id),
  FOREIGN KEY (organization_id, event_id) REFERENCES calendar_event (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX calendar_event_attendee_user ON calendar_event_attendee (organization_id, user_id);
