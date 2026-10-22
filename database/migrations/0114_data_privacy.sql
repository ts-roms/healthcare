-- Data Privacy Act coverage (docs/security/data-privacy-act.md).
--
-- 1. Data-subject requests beyond copies: a patient may ask in MyHealth for a correction, for erasure or blocking, or
--    object to a use of their data (RA 10173 rights, as the organization's own procedure answers them). The same
--    records-request workflow carries them; the platform records the request and the answer, never deletes or changes
--    a record by itself.
-- 2. A personal data breach register: incidents discovered, their assessment, the notifications the organization made
--    (to the NPC and to the data subjects) and their closure, append-only, with the organization's own notification
--    window. No notification rule is encoded: the window is the organization's setting (the NPC's circular gives 72
--    hours; the organization confirms it with its Data Protection Officer).

-- ---- 1. Kinds of records request ------------------------------------------------------------------------------------

ALTER TABLE records_request
  ADD COLUMN kind text NOT NULL DEFAULT 'access'
    CHECK (kind IN ('access', 'rectification', 'erasure', 'objection'));
-- A request other than for copies says what it is about.
ALTER TABLE records_request
  ADD CONSTRAINT records_request_kind_details CHECK (kind = 'access' OR length(btrim(details)) >= 10);

-- ---- 2. Privacy settings and the breach register --------------------------------------------------------------------

CREATE TABLE privacy_setting (
  organization_id            uuid        PRIMARY KEY REFERENCES organization (id),
  -- Hours from discovery within which the organization means to notify (its own value; reference only).
  breach_notification_hours  integer     NOT NULL DEFAULT 72 CHECK (breach_notification_hours BETWEEN 1 AND 720),
  -- The Data Protection Officer as the organization names them (shown to patients in MyHealth when set).
  dpo_name                   text        CHECK (length(btrim(dpo_name)) BETWEEN 2 AND 120),
  dpo_contact                text        CHECK (length(btrim(dpo_contact)) BETWEEN 3 AND 300),
  updated_by                 uuid        NOT NULL REFERENCES app_user (id),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  version                    integer     NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE privacy_incident_number_sequence (
  organization_id  uuid   PRIMARY KEY REFERENCES organization (id),
  next_value       bigint NOT NULL CHECK (next_value > 0)
);

CREATE TABLE privacy_incident (
  id                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id              uuid        NOT NULL REFERENCES organization (id),
  incident_number              text        NOT NULL CHECK (incident_number ~ '^PI[0-9]{8}$'),
  title                        text        NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  description                  text        NOT NULL CHECK (length(btrim(description)) BETWEEN 10 AND 4000),
  discovered_at                timestamptz NOT NULL,
  occurred_at                  timestamptz CHECK (occurred_at IS NULL OR occurred_at <= discovered_at),
  -- What kinds of personal data are involved, as assessed (the organization's categories of RA 10173's).
  data_categories              text[]      NOT NULL CHECK (cardinality(data_categories) BETWEEN 1 AND 6
                                             AND data_categories <@ ARRAY['identifiers', 'contact', 'health', 'financial', 'credentials', 'other']::text[]),
  affected_estimate            integer     CHECK (affected_estimate IS NULL OR affected_estimate >= 0),
  -- The organization's own notification window at the time of recording (hours from discovery).
  notify_by                    timestamptz NOT NULL,
  status                       text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  assessment                   text        NOT NULL DEFAULT 'pending' CHECK (assessment IN ('pending', 'notifiable', 'not_notifiable')),
  assessment_reason            text        CHECK (length(btrim(assessment_reason)) BETWEEN 10 AND 2000),
  assessed_at                  timestamptz,
  assessed_by                  uuid        REFERENCES app_user (id),
  npc_notified_at              timestamptz,
  npc_reference                text        CHECK (length(btrim(npc_reference)) BETWEEN 1 AND 200),
  subjects_notified_at         timestamptz,
  subjects_notification_method text        CHECK (length(btrim(subjects_notification_method)) BETWEEN 3 AND 500),
  closed_at                    timestamptz,
  closed_by                    uuid        REFERENCES app_user (id),
  closure_note                 text        CHECK (length(btrim(closure_note)) BETWEEN 10 AND 4000),
  reported_by                  uuid        NOT NULL REFERENCES app_user (id),
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  version                      integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, incident_number),
  CHECK ((assessment = 'pending') = (assessed_at IS NULL)),
  CHECK ((assessed_at IS NULL) = (assessed_by IS NULL)),
  CHECK (assessment = 'pending' OR assessment_reason IS NOT NULL),
  CHECK ((npc_notified_at IS NULL) OR (npc_reference IS NOT NULL)),
  CHECK ((subjects_notified_at IS NULL) = (subjects_notification_method IS NULL)),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CHECK ((closed_at IS NULL) = (closed_by IS NULL)),
  CHECK (status = 'open' OR closure_note IS NOT NULL),
  -- An incident is closed only once assessed.
  CHECK (status = 'open' OR assessment <> 'pending')
);
CREATE INDEX privacy_incident_open_idx ON privacy_incident (organization_id, status, discovered_at DESC);

-- What was done and when, in order; never edited.
CREATE TABLE privacy_incident_entry (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  incident_id      uuid        NOT NULL,
  kind             text        NOT NULL CHECK (kind IN ('reported', 'note', 'containment', 'assessment', 'npc_notified', 'subjects_notified', 'closed')),
  note             text        NOT NULL CHECK (length(btrim(note)) BETWEEN 3 AND 4000),
  recorded_by      uuid        NOT NULL REFERENCES app_user (id),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, incident_id) REFERENCES privacy_incident (organization_id, id)
);
CREATE INDEX privacy_incident_entry_idx ON privacy_incident_entry (incident_id, recorded_at, id);
CREATE TRIGGER privacy_incident_entry_append_only BEFORE UPDATE OR DELETE ON privacy_incident_entry
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
-- The register itself is never deleted.
CREATE TRIGGER privacy_incident_no_delete BEFORE DELETE ON privacy_incident
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- permissions ----------------------------------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('privacy.incident.manage', 'Keep the personal data breach register and the organization''s privacy settings (Data Protection Officer)');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'privacy.incident.manage' FROM role r WHERE r.key = 'org_admin' AND r.is_system
ON CONFLICT DO NOTHING;
