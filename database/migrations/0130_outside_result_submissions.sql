-- Outside results sent by patients from MyHealth (docs/domains/outside-results.md, "Sent by patients").
--
-- A patient uploads a report from another laboratory or hospital and says what it is in their own words. Nothing is
-- filed on their record until the records office has read it and files it (as an ordinary outside result, which a
-- clinician then reviews) or declines it with a reason the patient reads. The patient may withdraw it while it waits.
-- The platform reads nothing in the report and decides nothing about it.

INSERT INTO permission (key, description) VALUES
  ('outside-result.submission.manage', 'Answer outside results sent by patients: open the report, file it on the record or decline it with a reason');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('org_admin', 'outside-result.submission.manage'),
  ('records_officer', 'outside-result.submission.manage')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system
ON CONFLICT DO NOTHING;

CREATE TABLE outside_result_submission (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid         NOT NULL,
  patient_id          uuid         NOT NULL,
  -- The MyHealth account that sent it.
  portal_account_id   uuid         NOT NULL REFERENCES patient_portal_account (id),
  -- The patient's upload: a private document of category outside_result.
  document_id         uuid         NOT NULL,
  -- In the patient's own words; the records office files the record with its own reading of the report.
  source_name         text         NOT NULL CHECK (length(btrim(source_name)) BETWEEN 2 AND 200),
  tests               text         NOT NULL CHECK (length(btrim(tests)) BETWEEN 2 AND 500),
  performed_on        date,
  notes               text         CHECK (length(btrim(notes)) BETWEEN 1 AND 1000),
  status              text         NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'filed', 'declined', 'withdrawn')),
  -- filed: the outside result created from it.
  outside_result_id   uuid,
  -- declined: the reason the patient reads.
  decision_reason     text         CHECK (length(btrim(decision_reason)) BETWEEN 5 AND 500),
  decided_by          uuid         REFERENCES app_user (id),
  decided_at          timestamptz,
  withdrawn_at        timestamptz,
  submitted_at        timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)        REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, document_id)       REFERENCES document (organization_id, id),
  FOREIGN KEY (organization_id, outside_result_id) REFERENCES outside_result (organization_id, id),
  CHECK (status <> 'filed' OR (outside_result_id IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NULL AND withdrawn_at IS NULL)),
  CHECK (status <> 'declined' OR (decision_reason IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND outside_result_id IS NULL AND withdrawn_at IS NULL)),
  CHECK (status <> 'withdrawn' OR (withdrawn_at IS NOT NULL AND outside_result_id IS NULL AND decision_reason IS NULL AND decided_by IS NULL AND decided_at IS NULL)),
  CHECK (status <> 'submitted' OR (outside_result_id IS NULL AND decision_reason IS NULL AND decided_by IS NULL AND decided_at IS NULL AND withdrawn_at IS NULL))
);
-- One live submission per report.
CREATE UNIQUE INDEX outside_result_submission_document_once ON outside_result_submission (organization_id, document_id)
  WHERE status IN ('submitted', 'filed');
CREATE INDEX outside_result_submission_queue_idx ON outside_result_submission (organization_id, submitted_at) WHERE status = 'submitted';
CREATE INDEX outside_result_submission_patient_idx ON outside_result_submission (organization_id, patient_id, submitted_at DESC);

-- What was sent never changes: only the one move from 'submitted' to filed, declined or withdrawn, once. Never deleted.
CREATE FUNCTION outside_result_submission_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable constant text[] := ARRAY['status', 'outside_result_id', 'decision_reason', 'decided_by', 'decided_at', 'withdrawn_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'outside result submissions are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) OR OLD.status <> 'submitted' THEN
    RAISE EXCEPTION 'outside result submission: only the first answer (filed, declined or withdrawn) is permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER outside_result_submission_guard BEFORE UPDATE OR DELETE ON outside_result_submission
  FOR EACH ROW EXECUTE FUNCTION outside_result_submission_guard();
CREATE TRIGGER outside_result_submission_no_truncate BEFORE TRUNCATE ON outside_result_submission
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER outside_result_submission_not_for_merged_patient BEFORE INSERT ON outside_result_submission
  FOR EACH ROW EXECUTE FUNCTION refuse_record_for_merged_patient();
