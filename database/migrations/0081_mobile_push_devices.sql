-- Push notifications to the MyHealth mobile app (docs/domains/notification.md, "Push"; docs/architecture/mobile-app.md).
--
-- The mobile app registers its Expo push token in the same table as browsers, so the per-account device limit, removal,
-- "notification settings" and failure handling stay one thing. A message carries only what an SMS may: that something
-- is waiting, never a result, a name or a reason.
--
-- kind 'web'  : a browser (endpoint https address + p256dh + auth), as before.
-- kind 'expo' : an Expo push token (endpoint holds the token); no keys.

ALTER TABLE push_subscription DROP CONSTRAINT push_subscription_endpoint_check;
ALTER TABLE push_subscription DROP CONSTRAINT push_subscription_p256dh_check;
ALTER TABLE push_subscription DROP CONSTRAINT push_subscription_auth_check;

ALTER TABLE push_subscription
  ADD COLUMN kind text NOT NULL DEFAULT 'web' CHECK (kind IN ('web', 'expo')),
  -- A short name the app gives the device ("MyHealth app on iPhone"); browsers are described from their user agent.
  ADD COLUMN device_label text CHECK (device_label IS NULL OR length(btrim(device_label)) BETWEEN 1 AND 100),
  ALTER COLUMN p256dh DROP NOT NULL,
  ALTER COLUMN auth DROP NOT NULL;

ALTER TABLE push_subscription ADD CONSTRAINT push_subscription_kind_shape CHECK (
  (kind = 'web'
    AND endpoint ~ '^https://' AND length(endpoint) <= 2048
    AND p256dh IS NOT NULL AND length(p256dh) BETWEEN 40 AND 200
    AND auth IS NOT NULL AND length(auth) BETWEEN 10 AND 100)
  OR
  (kind = 'expo'
    AND endpoint ~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]{10,100}\]$'
    AND p256dh IS NULL AND auth IS NULL)
);
