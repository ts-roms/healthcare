-- Organization on the tables that hold patient data without one (docs/security/zero-trust-audit-2026-11-06.md, D7).
--
-- Row-level security (0111) covers every table with an organization_id. Five child tables of clinical and delivery
-- records had none, so a query reaching them was held by the application's own joins alone: care-plan goals, problems
-- and progress notes, prescription lines, and notification delivery attempts. Each now records its parent's
-- organization, a composite foreign key keeps the two equal (a row can never point at another organization's parent),
-- and apply_rls_policies() (run after every migration) gives each the ordinary organization policy.
--
-- The idempotency store was keyed by user and key only: a member of two organizations reusing a key in the second
-- could have been answered with the first one's stored response. It is now keyed by organization too. Its rows are
-- 24-hour retry records with no organization to backfill, so they are deleted: a retry sent across this deploy runs
-- again instead of being replayed.

-- 1. Care plans: goals, problems, progress notes.
ALTER TABLE care_plan_goal ADD COLUMN organization_id uuid;
ALTER TABLE care_plan_problem ADD COLUMN organization_id uuid;
ALTER TABLE care_plan_progress_note ADD COLUMN organization_id uuid;

UPDATE care_plan_goal g SET organization_id = p.organization_id FROM care_plan p WHERE p.id = g.care_plan_id;
UPDATE care_plan_problem c SET organization_id = p.organization_id FROM care_plan p WHERE p.id = c.care_plan_id;
-- Progress notes are append-only: the trigger is paused for the backfill only (the migration runs as the owner).
ALTER TABLE care_plan_progress_note DISABLE TRIGGER care_plan_progress_note_append_only;
UPDATE care_plan_progress_note n SET organization_id = p.organization_id FROM care_plan p WHERE p.id = n.care_plan_id;
ALTER TABLE care_plan_progress_note ENABLE TRIGGER care_plan_progress_note_append_only;

ALTER TABLE care_plan_goal ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT care_plan_goal_plan_same_organization FOREIGN KEY (organization_id, care_plan_id) REFERENCES care_plan (organization_id, id);
ALTER TABLE care_plan_problem ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT care_plan_problem_plan_same_organization FOREIGN KEY (organization_id, care_plan_id) REFERENCES care_plan (organization_id, id);
ALTER TABLE care_plan_progress_note ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT care_plan_progress_note_plan_same_organization FOREIGN KEY (organization_id, care_plan_id) REFERENCES care_plan (organization_id, id);

-- 2. Prescription lines (append-only).
ALTER TABLE prescription_item ADD COLUMN organization_id uuid;
ALTER TABLE prescription_item DISABLE TRIGGER prescription_item_append_only;
UPDATE prescription_item i SET organization_id = p.organization_id FROM prescription p WHERE p.id = i.prescription_id;
ALTER TABLE prescription_item ENABLE TRIGGER prescription_item_append_only;
ALTER TABLE prescription_item ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT prescription_item_prescription_same_organization FOREIGN KEY (organization_id, prescription_id) REFERENCES prescription (organization_id, id);

-- 3. Notification delivery attempts.
ALTER TABLE notification ADD CONSTRAINT notification_organization_id_id_key UNIQUE (organization_id, id);
ALTER TABLE notification_attempt ADD COLUMN organization_id uuid;
UPDATE notification_attempt a SET organization_id = n.organization_id FROM notification n WHERE n.id = a.notification_id;
ALTER TABLE notification_attempt ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT notification_attempt_notification_same_organization FOREIGN KEY (organization_id, notification_id) REFERENCES notification (organization_id, id);

-- 4. Idempotency records, per organization.
DELETE FROM idempotency_record;
ALTER TABLE idempotency_record ADD COLUMN organization_id uuid NOT NULL REFERENCES organization (id);
ALTER TABLE idempotency_record DROP CONSTRAINT idempotency_record_pkey;
ALTER TABLE idempotency_record ADD PRIMARY KEY (organization_id, user_id, idempotency_key);
