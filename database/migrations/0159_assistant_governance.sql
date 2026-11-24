-- Heuristic assistant, phase 4: governance (docs/architecture/heuristic-assistant.md, ADR-0018).
--
-- Two records for the organization's periodic review of its rules (docs/runbooks/assistant-rule-review.md): how often
-- each rule's suggestions were shown, and what the organization decided about a rule after reviewing it. Suggestions
-- themselves are still computed on demand and never stored.

-- Times each rule's suggestions were shown, per facility and local day: counts only, never a finding, a subject or a
-- person. A counter, so it is updated in place (one row per rule, facility and day).
CREATE TABLE assistant_rule_shown (
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  facility_id      uuid        NOT NULL,
  rule_id          text        NOT NULL CHECK (rule_id ~ '^[a-z0-9][a-z0-9.-]{1,80}$'),
  day              date        NOT NULL,
  shown            integer     NOT NULL CHECK (shown >= 0),
  PRIMARY KEY (organization_id, facility_id, rule_id, day),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id)
);

CREATE INDEX assistant_rule_shown_day ON assistant_rule_shown (organization_id, day DESC);

-- An organization's review of one rule: keep it, adjust its thresholds, or retire it (turned off everywhere in the
-- organization in the same transaction), why, and the false positives the review found. Append-only: a later review
-- is a new row.
CREATE TABLE assistant_rule_review (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  rule_id          text        NOT NULL CHECK (rule_id ~ '^[a-z0-9][a-z0-9.-]{1,80}$'),
  -- The rule's version when it was reviewed: a later version changes its logic or the meaning of its parameters.
  rule_version     integer     NOT NULL CHECK (rule_version > 0),
  outcome          text        NOT NULL CHECK (outcome IN ('keep', 'adjust', 'retire')),
  note             text        NOT NULL CHECK (length(btrim(note)) BETWEEN 3 AND 1000),
  false_positives  text        CHECK (false_positives IS NULL OR length(btrim(false_positives)) BETWEEN 3 AND 1000),
  reviewed_on      date        NOT NULL,
  recorded_by      uuid        NOT NULL REFERENCES app_user (id),
  recorded_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assistant_rule_review_rule ON assistant_rule_review (organization_id, rule_id, recorded_at DESC);

CREATE TRIGGER assistant_rule_review_append_only
  BEFORE UPDATE OR DELETE ON assistant_rule_review
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER assistant_rule_review_no_truncate
  BEFORE TRUNCATE ON assistant_rule_review
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();
