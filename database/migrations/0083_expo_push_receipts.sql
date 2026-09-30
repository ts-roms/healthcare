-- Expo push receipts (docs/domains/notification.md, "Push"; docs/architecture/mobile-app.md §8).
--
-- When the Expo push service accepts a message it answers with a ticket id. Whether Apple or Google then accepted the
-- message — or the app is gone from the phone — is reported only later, in the ticket's receipt (available for about a
-- day). The notification worker keeps each ticket here and asks for its receipt after 15 minutes: a gone app drops the
-- device at once (instead of after 5 failed sends), an accepted one marks the notification delivered to Apple/Google.
-- Rows hold ids and outcome codes only; no message content.

CREATE TABLE push_ticket (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid        NOT NULL,
  push_subscription_id uuid        NOT NULL REFERENCES push_subscription (id),
  -- The notification the message carried (null for sends outside a notification, e.g. from tests).
  notification_id      uuid        REFERENCES notification (id),
  ticket_id            text        NOT NULL UNIQUE CHECK (length(ticket_id) BETWEEN 1 AND 100),
  sent_at              timestamptz NOT NULL DEFAULT now(),
  -- null: not answered yet; ok / error: Expo's receipt; expired: no receipt came within its lifetime.
  receipt_status       text        CHECK (receipt_status IN ('ok', 'error', 'expired')),
  receipt_error        text        CHECK (receipt_error IS NULL OR length(receipt_error) <= 100),
  checked_at           timestamptz,
  check_count          integer     NOT NULL DEFAULT 0 CHECK (check_count >= 0),
  CHECK ((receipt_status IS NULL) = (checked_at IS NULL)),
  CHECK (receipt_error IS NULL OR receipt_status = 'error')
);

CREATE INDEX push_ticket_pending_idx ON push_ticket (sent_at) WHERE receipt_status IS NULL;
CREATE INDEX push_ticket_notification_idx ON push_ticket (notification_id) WHERE notification_id IS NOT NULL;
