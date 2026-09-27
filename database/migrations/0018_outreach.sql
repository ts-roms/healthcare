-- Patient outreach (Phase 4c). See docs/domains/care-plan.md ("Recall reminders").
--
-- Recall reminders for care-plan follow-ups: which reminder was sent for which
-- activity and due date, so each is sent once ("due" before the date, "overdue"
-- a week after) even if the job runs many times or on several API instances.
-- The message itself is a notification (consent and preferences apply there).

ALTER TABLE care_plan_activity ADD CONSTRAINT care_plan_activity_org_patient_uq UNIQUE (organization_id, patient_id, id);

CREATE TABLE care_plan_activity_reminder (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  patient_id        uuid        NOT NULL,
  activity_id       uuid        NOT NULL,
  due_date          date        NOT NULL,
  kind              text        NOT NULL CHECK (kind IN ('due', 'overdue')),
  notification_id   uuid        REFERENCES notification (id),
  sent_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (activity_id, due_date, kind),
  FOREIGN KEY (organization_id, patient_id, activity_id) REFERENCES care_plan_activity (organization_id, patient_id, id)
);
CREATE INDEX care_plan_activity_reminder_patient_idx ON care_plan_activity_reminder (organization_id, patient_id, sent_at);

-- Reminders are history: never rewritten or deleted.
CREATE TRIGGER care_plan_activity_reminder_append_only
  BEFORE UPDATE OR DELETE ON care_plan_activity_reminder
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
