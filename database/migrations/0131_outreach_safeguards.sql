-- Outreach safeguards (docs/domains/crm.md, "Reach, limits and the booking link").
--
-- 1. A campaign may carry a link to book a visit in MyHealth (a plain address with no patient detail in it; signing in
--    is what identifies the patient). It is part of what the second person approves, so it is chosen while drafting.
-- 2. The organization's own limits on how often and when outreach goes out: a frequency cap (at most N campaigns reach
--    one patient in D days) and quiet hours (SMS and push are held until the quiet period ends, in Asia/Manila time).
--    Both are off until an administrator sets them. A patient held back by the cap is recorded as suppressed with the
--    reason frequency_cap; a message held for quiet hours is queued and sent when the period ends.
-- 3. Reach figures (who a campaign can actually reach) are computed on request from the same consent checks the send
--    uses; nothing about them is stored.

ALTER TABLE crm_campaign ADD COLUMN include_booking_link boolean NOT NULL DEFAULT false;

CREATE TABLE crm_setting (
  organization_id     uuid        PRIMARY KEY REFERENCES organization (id),
  -- At most this many outreach campaigns reach one patient within the window; null = no cap.
  cap_max_campaigns   smallint    CHECK (cap_max_campaigns BETWEEN 1 AND 20),
  cap_window_days     smallint    CHECK (cap_window_days BETWEEN 1 AND 365),
  quiet_hours_enabled boolean     NOT NULL DEFAULT false,
  -- Local clock times in Asia/Manila ("22:00"–"07:00" crosses midnight).
  quiet_start         text        CHECK (quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  quiet_end           text        CHECK (quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- Channels held during quiet hours (a MyHealth inbox message is never "heard" at night, so it is not offered).
  quiet_channels      text[]      NOT NULL DEFAULT ARRAY['sms', 'push'] CHECK (quiet_channels <@ ARRAY['sms', 'email', 'push']),
  version             integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by          uuid        NOT NULL REFERENCES app_user (id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((cap_max_campaigns IS NULL) = (cap_window_days IS NULL)),
  CHECK (NOT quiet_hours_enabled OR (quiet_start IS NOT NULL AND quiet_end IS NOT NULL AND quiet_start <> quiet_end AND cardinality(quiet_channels) > 0))
);
