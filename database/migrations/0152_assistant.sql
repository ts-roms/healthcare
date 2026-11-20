-- Heuristic assistant, phase 0 (docs/architecture/heuristic-assistant.md, ADR-0018).
--
-- The assistant computes suggestions on demand from rules over data the caller may read; nothing it suggests is stored.
-- Two things are kept: which rules an organization (or one facility) turned on with what parameters, and what staff
-- did with a suggestion. Both are append-only: a setting is changed by adding a version, and the latest version of the
-- facility's row (else the organization's) is the one in force. A rule with no setting is off.

CREATE TABLE assistant_rule_setting (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  -- Null: the organization's setting, used by every facility without its own.
  facility_id      uuid,
  rule_id          text        NOT NULL CHECK (rule_id ~ '^[a-z0-9][a-z0-9.-]{1,80}$'),
  version          integer     NOT NULL CHECK (version > 0),
  enabled          boolean     NOT NULL,
  -- Validated by the rule's own schema before it is written; the rule's meaning is its version, not this column.
  parameters       jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parameters) = 'object'),
  updated_by       uuid        NOT NULL REFERENCES app_user (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id)
);

CREATE UNIQUE INDEX assistant_rule_setting_version
  ON assistant_rule_setting (organization_id, COALESCE(facility_id, '00000000-0000-0000-0000-000000000000'::uuid), rule_id, version);

CREATE TRIGGER assistant_rule_setting_append_only
  BEFORE UPDATE OR DELETE ON assistant_rule_setting
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER assistant_rule_setting_no_truncate
  BEFORE TRUNCATE ON assistant_rule_setting
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();

CREATE TABLE assistant_feedback (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  facility_id      uuid,
  user_id          uuid        NOT NULL REFERENCES app_user (id),
  rule_id          text        NOT NULL CHECK (rule_id ~ '^[a-z0-9][a-z0-9.-]{1,80}$'),
  rule_version     integer     NOT NULL CHECK (rule_version > 0),
  -- The finding the person answered, as the suggestion id carried it (ids only: no names, values or free text of a record).
  subject_key      text        NOT NULL CHECK (length(subject_key) BETWEEN 1 AND 200),
  outcome          text        NOT NULL CHECK (outcome IN ('accepted', 'dismissed', 'not_useful')),
  reason           text        CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 500),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id)
);

-- Which of a person's recent answers hide a suggestion, and the insights count per rule.
CREATE INDEX assistant_feedback_user_recent ON assistant_feedback (organization_id, user_id, created_at DESC);
CREATE INDEX assistant_feedback_rule_recent ON assistant_feedback (organization_id, rule_id, created_at DESC);

CREATE TRIGGER assistant_feedback_append_only
  BEFORE UPDATE OR DELETE ON assistant_feedback
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER assistant_feedback_no_truncate
  BEFORE TRUNCATE ON assistant_feedback
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();

-- ---- permissions --------------------------------------------------------------------------------------------------

INSERT INTO permission (key, description)
VALUES
  ('assistant.use', 'See and answer the assistant''s suggestions on the screens the caller already has access to'),
  ('assistant.configure', 'Turn assistant rules on or off for the organization or a facility and set their parameters'),
  ('assistant.insights.read', 'See how often each assistant rule was shown, accepted and dismissed');

-- Phase 0 has one rule, about stock: the people who manage stock see it. Later phases add roles with their rules.
INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'assistant.use' FROM role r
WHERE r.key IN ('org_admin', 'inventory_officer') AND r.is_system
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, p.key FROM role r CROSS JOIN (VALUES ('assistant.configure'), ('assistant.insights.read')) AS p (key)
WHERE r.key = 'org_admin' AND r.is_system
ON CONFLICT DO NOTHING;
