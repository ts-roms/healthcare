-- The assistant's Ask (docs/domains/assistant.md, "Ask"; ADR-0019): typed operational questions answered from a closed
-- catalogue, each by the public method of the route that already shows its figure, with that route's permissions and
-- audit. No model, nothing sent outside the platform.
--
-- A person's recent and saved questions are kept as the catalogue question, its period and its scope: never the words
-- typed (a patient's name typed by mistake must not be kept anywhere). The rows are the person's own and mutable: they
-- save, unsave, remove and clear them; the audit trail (`assistant.ask`) is the durable record of what was asked.

INSERT INTO permission (key, description)
VALUES
  ('assistant.ask', 'Ask the assistant questions from its fixed list, answered only from figures the person may already open')
ON CONFLICT DO NOTHING;

-- Everyone who sees the assistant's suggestions may ask it questions; each question still needs its own figures'
-- permissions.
INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'assistant.ask' FROM role r
WHERE r.key IN (
  'org_admin',
  'inventory_officer',
  'cashier',
  'receptionist',
  'nurse',
  'physician',
  'dentist',
  'medical_technologist',
  'pathologist',
  'pharmacist'
) AND r.is_system
ON CONFLICT DO NOTHING;

CREATE TABLE assistant_asked_question (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  user_id          uuid        NOT NULL REFERENCES app_user (id),
  question_id      text        NOT NULL CHECK (question_id ~ '^[a-z0-9][a-z0-9.-]{1,80}$'),
  -- A period key (`last-week`, `2026-10`, `2026-11-01..2026-11-15`; libs/core assistant/ask/period.ts), '' for the
  -- question's own default or a question that takes none.
  period_key       text        NOT NULL DEFAULT '' CHECK (period_key = '' OR period_key ~ '^[a-z0-9.-]{1,40}$'),
  compare_key      text        NOT NULL DEFAULT '' CHECK (compare_key IN ('', 'previous', 'last-year')),
  scope            text        NOT NULL DEFAULT 'facility' CHECK (scope IN ('facility', 'organization')),
  times_asked      integer     NOT NULL DEFAULT 1 CHECK (times_asked > 0),
  last_asked_at    timestamptz NOT NULL DEFAULT now(),
  saved_at         timestamptz,
  UNIQUE (organization_id, user_id, question_id, period_key, compare_key, scope)
);

-- A person's questions, latest first.
CREATE INDEX assistant_asked_question_recent ON assistant_asked_question (organization_id, user_id, last_asked_at DESC);
