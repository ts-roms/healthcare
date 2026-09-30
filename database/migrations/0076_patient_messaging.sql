-- Two-way messaging in MyHealth: a patient and the clinic write to each other in conversations.
-- See docs/architecture/portal-app.md ("Messages") and docs/domains/patient-messaging.md.
--
-- A conversation is filed under one patient and routed to the facility where the patient is registered. Messages are
-- append-only: nothing a patient or the clinic wrote is edited or deleted. This is not an emergency channel and is
-- not watched in real time; MyHealth says so wherever a patient writes.

CREATE TABLE patient_message_thread (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL,
  patient_id            uuid        NOT NULL,
  facility_id           uuid        NOT NULL REFERENCES facility (id),
  topic                 text        NOT NULL CHECK (topic IN ('general', 'appointment', 'results', 'medication', 'billing', 'other')),
  subject               text        NOT NULL CHECK (length(btrim(subject)) BETWEEN 1 AND 100),
  started_by            text        NOT NULL CHECK (started_by IN ('patient', 'staff')),
  status                text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  assigned_to           uuid        REFERENCES app_user (id),
  message_count         integer     NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  last_message_at       timestamptz NOT NULL DEFAULT now(),
  last_message_from     text        NOT NULL CHECK (last_message_from IN ('patient', 'staff')),
  -- The patient has read the clinic's messages up to here.
  patient_read_through  timestamptz,
  closed_at             timestamptz,
  closed_by             uuid        REFERENCES app_user (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  version               integer     NOT NULL DEFAULT 1,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

CREATE INDEX patient_message_thread_patient_idx ON patient_message_thread (patient_id, last_message_at DESC);
-- The clinic's work queue: open conversations, the ones waiting for a reply first.
CREATE INDEX patient_message_thread_queue_idx ON patient_message_thread (organization_id, facility_id, last_message_at) WHERE status = 'open';

CREATE TABLE patient_message (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid        NOT NULL,
  thread_id                 uuid        NOT NULL,
  patient_id                uuid        NOT NULL,
  sender_type               text        NOT NULL CHECK (sender_type IN ('patient', 'staff')),
  sender_portal_account_id  uuid,
  sender_user_id            uuid        REFERENCES app_user (id),
  body                      text        NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at                timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, thread_id) REFERENCES patient_message_thread (organization_id, id),
  FOREIGN KEY (organization_id, sender_portal_account_id) REFERENCES patient_portal_account (organization_id, id),
  CHECK ((sender_type = 'patient') = (sender_portal_account_id IS NOT NULL)),
  CHECK ((sender_type = 'staff') = (sender_user_id IS NOT NULL))
);

CREATE INDEX patient_message_thread_messages_idx ON patient_message (thread_id, created_at, id);
-- The patient's own sending rate.
CREATE INDEX patient_message_patient_sent_idx ON patient_message (patient_id, created_at DESC) WHERE sender_type = 'patient';

CREATE TRIGGER patient_message_append_only BEFORE UPDATE OR DELETE ON patient_message
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- New conversations are not started under a merged record (replies to existing ones are corrections of what exists).
CREATE TRIGGER patient_message_thread_not_for_merged_patient BEFORE INSERT ON patient_message_thread
  FOR EACH ROW EXECUTE FUNCTION refuse_record_for_merged_patient();

-- ---- permissions ---------------------------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('patient.message.read', 'Read patients'' MyHealth conversations'),
  ('patient.message.manage', 'Reply to patients in MyHealth, start conversations, assign, close and reopen them');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, p.key FROM role r
CROSS JOIN (VALUES ('patient.message.read'), ('patient.message.manage')) AS p (key)
WHERE r.key IN ('org_admin', 'receptionist', 'nurse', 'physician', 'dentist', 'records_officer') AND r.is_system
ON CONFLICT DO NOTHING;
