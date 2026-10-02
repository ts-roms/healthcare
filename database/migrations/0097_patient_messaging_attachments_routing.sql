-- MyHealth conversations (docs/domains/patient-messaging.md, migration 0076): attachments, staff-only internal notes,
-- routing by topic to a role or a person, and response-time targets with overdue reminders.
--
-- 1. Attachments: a message may carry up to three documents of the patient's record. The clinic attaches documents it
--    holds or uploads; the patient uploads images or PDFs in MyHealth (a `clinical_attachment` document of their own
--    record, created by their portal account, 10 MB, ten a day). Files open through short-lived audited links; the
--    notice to the patient still carries no content. Malware scanning stays a dependency (docs/domains/documents.md).
-- 2. Internal notes: staff-only text on a conversation, never shown to the patient (no portal query reads the table).
-- 3. Routing and targets per facility and topic (`patient_message_setting`): who is told of a new patient message (a
--    role key or one person; optionally assigned on arrival) and the calendar hours within which the clinic means to
--    answer. A conversation waiting for the clinic carries `response_due_at`; an hourly job tells the responsible people
--    once per breach. Business hours are not modelled.

-- ---- documents: uploaded by a patient in MyHealth -----------------------------------------------------------------

ALTER TABLE document
  ADD COLUMN created_by_portal_account uuid,
  ADD FOREIGN KEY (organization_id, created_by_portal_account) REFERENCES patient_portal_account (organization_id, id),
  DROP CONSTRAINT document_source_check,
  ADD CONSTRAINT document_source_check CHECK (source IN ('upload', 'generated', 'patient_upload')),
  -- A staff user creates uploads; generated documents and patient uploads name none (0030 named only 'generated').
  DROP CONSTRAINT document_created_by_check,
  ADD CONSTRAINT document_created_by_check CHECK (created_by IS NOT NULL OR source IN ('generated', 'patient_upload')),
  -- A patient upload names the account and no staff user; a generated document names neither.
  ADD CONSTRAINT document_patient_upload_creator CHECK (
    (source = 'patient_upload') = (created_by_portal_account IS NOT NULL) AND (created_by_portal_account IS NULL OR created_by IS NULL)
  );
CREATE INDEX document_patient_upload_idx ON document (created_by_portal_account, created_at DESC) WHERE created_by_portal_account IS NOT NULL;

-- ---- attachments ---------------------------------------------------------------------------------------------------

ALTER TABLE patient_message ADD CONSTRAINT patient_message_organization_id_id_key UNIQUE (organization_id, id);

CREATE TABLE patient_message_attachment (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  patient_id       uuid        NOT NULL,
  thread_id        uuid        NOT NULL,
  message_id       uuid        NOT NULL,
  document_id      uuid        NOT NULL,
  position         smallint    NOT NULL CHECK (position BETWEEN 0 AND 2),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, document_id),
  UNIQUE (message_id, position),
  FOREIGN KEY (organization_id, thread_id)              REFERENCES patient_message_thread (organization_id, id),
  FOREIGN KEY (organization_id, message_id)             REFERENCES patient_message (organization_id, id),
  -- A document of the same patient (0014 gave `document` this key).
  FOREIGN KEY (organization_id, patient_id, document_id) REFERENCES document (organization_id, patient_id, id)
);
CREATE INDEX patient_message_attachment_thread_idx ON patient_message_attachment (thread_id);
CREATE INDEX patient_message_attachment_document_idx ON patient_message_attachment (document_id);
CREATE TRIGGER patient_message_attachment_append_only BEFORE UPDATE OR DELETE ON patient_message_attachment
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- staff-only internal notes --------------------------------------------------------------------------------------

CREATE TABLE patient_message_note (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  thread_id        uuid        NOT NULL,
  patient_id       uuid        NOT NULL,
  author_user_id   uuid        NOT NULL REFERENCES app_user (id),
  body             text        NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, thread_id)  REFERENCES patient_message_thread (organization_id, id),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id)
);
CREATE INDEX patient_message_note_thread_idx ON patient_message_note (thread_id, created_at);
CREATE TRIGGER patient_message_note_append_only BEFORE UPDATE OR DELETE ON patient_message_note
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- routing and response targets per facility and topic ---------------------------------------------------------

CREATE TABLE patient_message_setting (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid        NOT NULL,
  facility_id            uuid        NOT NULL,
  topic                  text        NOT NULL CHECK (topic IN ('general', 'appointment', 'results', 'medication', 'billing', 'other')),
  -- Who is told of a new patient message: a role of the organization (its key), or one person; neither = everyone who can reply.
  route_role_key         text        CHECK (route_role_key ~ '^[a-z0-9_]{1,60}$'),
  route_user_id          uuid        REFERENCES app_user (id),
  -- With a person named: the conversation is assigned to them on arrival (else they are only told).
  auto_assign            boolean     NOT NULL DEFAULT false,
  -- Calendar hours within which the clinic means to answer; null = no target.
  response_target_hours  integer     CHECK (response_target_hours BETWEEN 1 AND 168),
  updated_by             uuid        NOT NULL REFERENCES app_user (id),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  version                integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (facility_id, topic),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  CHECK (route_role_key IS NULL OR route_user_id IS NULL),
  CHECK (NOT auto_assign OR route_user_id IS NOT NULL)
);

ALTER TABLE patient_message_thread
  -- When the clinic means to have answered the patient's latest message (null without a target, or once answered).
  ADD COLUMN response_due_at      timestamptz,
  -- The breach the responsible people were last reminded of.
  ADD COLUMN overdue_notified_at  timestamptz;
CREATE INDEX patient_message_thread_due_idx ON patient_message_thread (response_due_at) WHERE status = 'open' AND last_message_from = 'patient' AND response_due_at IS NOT NULL;
