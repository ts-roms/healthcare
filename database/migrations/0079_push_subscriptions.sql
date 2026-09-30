-- Push notifications to a patient's phone or computer through the browser (Web Push, RFC 8030/8291, VAPID).
-- See docs/domains/notification.md ("Push") and docs/architecture/portal-app.md ("Push notifications").
--
-- MyHealth registers a device after the patient allows notifications in their browser. A push message carries only
-- what an SMS may: that something is waiting, never a result, a name or a reason. No provider account is involved
-- beyond the browser vendor's own push service; the platform needs its VAPID key pair (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).

CREATE TABLE push_subscription (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  portal_account_id uuid        NOT NULL,
  -- The browser vendor's push address for this device: sending to it needs our VAPID key, receiving needs the keys below.
  endpoint          text        NOT NULL UNIQUE CHECK (endpoint ~ '^https://' AND length(endpoint) <= 2048),
  p256dh            text        NOT NULL CHECK (length(p256dh) BETWEEN 40 AND 200),
  auth              text        NOT NULL CHECK (length(auth) BETWEEN 10 AND 100),
  user_agent        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_success_at   timestamptz,
  last_failure_at   timestamptz,
  failure_count     integer     NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  revoked_at        timestamptz,
  revoked_reason    text        CHECK (revoked_reason IN ('removed_by_patient', 'gone', 'failing', 'moved_to_another_account')),
  FOREIGN KEY (organization_id, portal_account_id) REFERENCES patient_portal_account (organization_id, id),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

CREATE INDEX push_subscription_account_idx ON push_subscription (portal_account_id) WHERE revoked_at IS NULL;
