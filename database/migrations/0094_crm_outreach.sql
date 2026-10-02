-- Outreach (CLAUDE.md §16; docs/domains/crm.md): segments the organization defines from non-clinical criteria,
-- campaigns approved by someone other than their author and sent through the notification service under each
-- patient's explicit outreach opt-in per channel, one delivery row per patient and channel, and single-use tokens
-- for the opt-out link in outreach emails. Nothing here holds a diagnosis, a result or a message a patient wrote.

INSERT INTO permission (key, description) VALUES
  ('crm.read',             'View outreach segments, campaigns and their results'),
  ('crm.segment.manage',   'Create and change outreach segments (saved patient lists from the organization''s criteria)'),
  ('crm.campaign.manage',  'Create, submit and cancel outreach campaigns'),
  ('crm.campaign.approve', 'Approve an outreach campaign written by someone else');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, p.key FROM role r CROSS JOIN (VALUES ('crm.read'), ('crm.segment.manage'), ('crm.campaign.manage'), ('crm.campaign.approve')) AS p (key)
WHERE r.key = 'org_admin' AND r.is_system
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'crm.read' FROM role r WHERE r.key = 'records_officer' AND r.is_system
ON CONFLICT DO NOTHING;

CREATE TABLE crm_segment (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  name             text        NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  description      text        CHECK (length(description) <= 500),
  -- The organization's own criteria (age range, sex, place, registration and last-visit dates, care-plan activity due,
  -- outreach opt-in on a channel), validated by the API; a configurable form, hence JSONB. Never a diagnosis, a result
  -- or a medication: selecting people by health data for outreach is a compliance decision before it is built.
  criteria         jsonb       NOT NULL,
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version          integer     NOT NULL DEFAULT 1,
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  updated_by       uuid        NOT NULL REFERENCES app_user (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, name)
);

CREATE TABLE crm_campaign (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  segment_id       uuid        NOT NULL,
  name             text        NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  -- Channels the campaign goes out on; the patient's own opt-in per channel decides at send time.
  channels         text[]      NOT NULL CHECK (cardinality(channels) BETWEEN 1 AND 4 AND channels <@ ARRAY['sms', 'email', 'push', 'in_app']),
  -- The organization's own wording: a subject (email and in-app) and one plain-text body for every channel.
  subject          text        CHECK (length(subject) BETWEEN 2 AND 120),
  body             text        NOT NULL CHECK (length(btrim(body)) BETWEEN 10 AND 2000),
  status           text        NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft', 'submitted', 'approved', 'sending', 'completed', 'cancelled')),
  -- When to send once approved; null = as soon as the runner next looks (within a minute).
  send_at          timestamptz,
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  submitted_by     uuid        REFERENCES app_user (id),
  submitted_at     timestamptz,
  -- Never the author: the second person who read the wording and the segment.
  approved_by      uuid        REFERENCES app_user (id),
  approved_at      timestamptz,
  cancelled_by     uuid        REFERENCES app_user (id),
  cancelled_at     timestamptz,
  cancel_reason    text        CHECK (length(cancel_reason) BETWEEN 3 AND 500),
  started_at       timestamptz,
  completed_at     timestamptz,
  version          integer     NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, segment_id) REFERENCES crm_segment (organization_id, id),
  CHECK (approved_by IS NULL OR approved_by <> created_by),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CHECK ((cancelled_by IS NULL) = (cancelled_at IS NULL) AND (cancelled_at IS NULL) = (cancel_reason IS NULL)),
  CHECK (status NOT IN ('approved', 'sending', 'completed') OR approved_by IS NOT NULL),
  CHECK (status <> 'cancelled' OR cancelled_by IS NOT NULL)
);
CREATE INDEX crm_campaign_due_idx ON crm_campaign (status, send_at) WHERE status IN ('approved', 'sending');

-- One row per patient and channel the runner looked at: what the notification service did with it. Append-only.
CREATE TABLE crm_campaign_delivery (
  campaign_id      uuid        NOT NULL,
  organization_id  uuid        NOT NULL,
  patient_id       uuid        NOT NULL,
  channel          text        NOT NULL CHECK (channel IN ('sms', 'email', 'push', 'in_app')),
  notification_id  uuid        REFERENCES notification (id),
  outcome          text        NOT NULL CHECK (outcome IN ('queued', 'delivered', 'suppressed', 'failed')),
  -- The notification service's suppression reason (no_outreach_opt_in, patient_inactive, no_contact, ...).
  reason           text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, patient_id, channel),
  FOREIGN KEY (organization_id, campaign_id) REFERENCES crm_campaign (organization_id, id),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id)
);
CREATE INDEX crm_campaign_delivery_patient_idx ON crm_campaign_delivery (organization_id, patient_id);

CREATE TRIGGER crm_campaign_delivery_append_only
  BEFORE UPDATE OR DELETE ON crm_campaign_delivery
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- The opt-out link in an outreach email: a single-use token bound to the patient, the channel and the campaign; only
-- its hash is stored.
CREATE TABLE crm_opt_out_token (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  patient_id       uuid        NOT NULL,
  campaign_id      uuid        NOT NULL,
  channel          text        NOT NULL CHECK (channel IN ('sms', 'email', 'push', 'in_app')),
  token_hash       text        NOT NULL UNIQUE,
  expires_at       timestamptz NOT NULL,
  used_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, campaign_id) REFERENCES crm_campaign (organization_id, id)
);

-- An opt-out recorded from the link in an outreach email is made by the platform, not by a staff member or the
-- patient's MyHealth account: both recorder columns stay null (the audit trail names the campaign). Until now exactly
-- one had to be set.
ALTER TABLE patient_communication_preference
  DROP CONSTRAINT patient_communication_preference_one_recorder,
  ADD CONSTRAINT patient_communication_preference_one_recorder CHECK (updated_by IS NULL OR updated_by_portal_account IS NULL);
