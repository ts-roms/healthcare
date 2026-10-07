-- Notifications (docs/domains/notification.md): the facility a message was sent from, and staff push preferences (D4 phase 3).
--
-- A notification now records the facility the requesting actor was acting in (the X-Facility-Id of the request, or
-- the facility of the system job), so the communication log can be read per facility and a member whose
-- `notification.read` is scoped to facilities sees only those facilities' messages. Messages sent before this
-- migration, and messages sent outside any facility, keep a null facility ("Facility not recorded"): nothing is
-- backfilled, since the facility of a past send cannot be known.
--
-- A staff member may turn the browser push of a kind of in-app notice off (and on again); the in-app notice itself
-- is never affected and no suppressed row is written for a push the member declined.

ALTER TABLE notification
  ADD COLUMN facility_id uuid,
  ADD CONSTRAINT notification_facility_fk FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id);
CREATE INDEX notification_facility_log_idx ON notification (organization_id, facility_id, created_at DESC, id DESC) WHERE recipient_type = 'patient';

CREATE TABLE staff_push_preference (
  organization_id uuid        NOT NULL REFERENCES organization (id),
  user_id         uuid        NOT NULL REFERENCES app_user (id),
  -- What the in-app notices are about; the kind of each template is set in code (libs/notification templates).
  kind            text        NOT NULL CHECK (kind IN ('records_requests', 'patient_messages', 'referrals', 'laboratory_results', 'laboratory_quality', 'documents', 'management_reports')),
  enabled         boolean     NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, kind)
);
