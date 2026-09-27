CREATE TABLE notification (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL REFERENCES organization (id),
  recipient_type        text        NOT NULL CHECK (recipient_type IN ('patient', 'user')),
  recipient_patient_id  uuid,
  recipient_user_id     uuid        REFERENCES app_user (id),
  channel               text        NOT NULL CHECK (channel IN ('sms', 'email', 'push', 'in_app')),
  category              text        NOT NULL CHECK (category IN ('clinical', 'administrative', 'outreach', 'security')),
  template_key          text        NOT NULL,
  template_version      integer     NOT NULL CHECK (template_version > 0),
  -- Resolved at creation time so delivery is reproducible and auditable.
  destination           text,
  variables             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status                text        NOT NULL CHECK (status IN
                          ('queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled', 'suppressed')),
  suppression_reason    text,
  idempotency_key       text,
  attempt_count         integer     NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts          integer     NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  last_error            text,
  provider              text,
  provider_message_id   text,
  scheduled_for         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid        REFERENCES app_user (id),
  sent_at               timestamptz,
  delivered_at          timestamptz,
  failed_at             timestamptz,
  cancelled_at          timestamptz,
  read_at               timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, recipient_patient_id) REFERENCES patient (organization_id, id),
  CHECK ((recipient_type = 'patient') = (recipient_patient_id IS NOT NULL)),
  CHECK ((recipient_type = 'user') = (recipient_user_id IS NOT NULL)),
  CHECK ((status = 'suppressed') = (suppression_reason IS NOT NULL)),
  CHECK (channel = 'in_app' OR status = 'suppressed' OR destination IS NOT NULL),
  CHECK (attempt_count <= max_attempts)
);
CREATE UNIQUE INDEX notification_idempotency_uq ON notification (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX notification_patient_idx ON notification (recipient_patient_id, created_at DESC) WHERE recipient_patient_id IS NOT NULL;
CREATE INDEX notification_user_inbox_idx ON notification (recipient_user_id, created_at DESC) WHERE channel = 'in_app';
CREATE INDEX notification_pending_idx ON notification (status, created_at) WHERE status IN ('queued', 'sending');

CREATE TABLE notification_attempt (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id  uuid        NOT NULL REFERENCES notification (id),
  attempt_number   integer     NOT NULL CHECK (attempt_number > 0),
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  outcome          text        CHECK (outcome IN ('sent', 'failed')),
  error            text,
  provider         text,
  UNIQUE (notification_id, attempt_number)
);
