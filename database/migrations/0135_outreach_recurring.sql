-- Outreach: recurring campaigns (docs/domains/crm.md, "Recurring campaigns").
--
-- A series is a campaign that repeats: the same wording and segment, sent every week or every month at a time of day in
-- Asia/Manila, between a start and an optional end date. Like any campaign it needs a second person to approve it, and
-- approving it approves every occurrence; changing the wording, the segment or the schedule means pausing it, taking it
-- back to a draft and having it approved again. Each occurrence is an ordinary approved campaign created at its time
-- (series_id, occurrence_on): the segment is evaluated at that moment, patients are checked against their opt-in, the
-- frequency cap and quiet hours apply, and the results are those of any campaign. An occurrence missed because the
-- system was down for more than six hours is skipped, never sent late in a burst.

CREATE TABLE crm_campaign_series (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid        NOT NULL REFERENCES organization (id),
  segment_id           uuid        NOT NULL,
  name                 text        NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  channels             text[]      NOT NULL CHECK (cardinality(channels) BETWEEN 1 AND 4 AND channels <@ ARRAY['sms', 'email', 'push', 'in_app']),
  subject              text        CHECK (length(subject) BETWEEN 2 AND 120),
  body                 text        NOT NULL CHECK (length(btrim(body)) BETWEEN 10 AND 2000),
  include_booking_link boolean     NOT NULL DEFAULT false,
  delivery_mode        text        NOT NULL DEFAULT 'all' CHECK (delivery_mode IN ('all', 'first_available')),
  cadence              text        NOT NULL CHECK (cadence IN ('weekly', 'monthly')),
  -- weekly: 0 = Sunday ... 6 = Saturday. monthly: the day of the month (1 to 28, so every month has it).
  weekday              smallint    CHECK (weekday BETWEEN 0 AND 6),
  day_of_month         smallint    CHECK (day_of_month BETWEEN 1 AND 28),
  -- Local clock time in Asia/Manila.
  send_time            text        NOT NULL CHECK (send_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  starts_on            date        NOT NULL,
  ends_on              date,
  status               text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'active', 'paused', 'ended', 'cancelled')),
  -- The occurrence to create next while active; null otherwise.
  next_run_at          timestamptz,
  created_by           uuid        NOT NULL REFERENCES app_user (id),
  submitted_by         uuid        REFERENCES app_user (id),
  submitted_at         timestamptz,
  -- Never the author: the second person who read the wording, the segment and the schedule.
  approved_by          uuid        REFERENCES app_user (id),
  approved_at          timestamptz,
  approval_reminded_at timestamptz,
  closed_by            uuid        REFERENCES app_user (id),
  closed_at            timestamptz,
  close_reason         text        CHECK (length(close_reason) BETWEEN 3 AND 500),
  version              integer     NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, segment_id) REFERENCES crm_segment (organization_id, id),
  CHECK ((cadence = 'weekly') = (weekday IS NOT NULL)),
  CHECK ((cadence = 'monthly') = (day_of_month IS NOT NULL)),
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CHECK (approved_by IS NULL OR approved_by <> created_by),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CHECK (status NOT IN ('active', 'paused') OR approved_by IS NOT NULL),
  CHECK ((closed_by IS NULL) = (closed_at IS NULL)),
  CHECK (status NOT IN ('ended', 'cancelled') OR (closed_by IS NOT NULL OR close_reason IS NOT NULL)),
  CHECK (status = 'active' OR next_run_at IS NULL)
);
CREATE INDEX crm_campaign_series_due_idx ON crm_campaign_series (next_run_at) WHERE status = 'active';

-- The occurrences: ordinary campaigns that remember which series and which day they are for (one per day).
ALTER TABLE crm_campaign
  ADD COLUMN series_id uuid,
  ADD COLUMN occurrence_on date,
  ADD CONSTRAINT crm_campaign_series_fk FOREIGN KEY (organization_id, series_id) REFERENCES crm_campaign_series (organization_id, id),
  ADD CONSTRAINT crm_campaign_series_pair CHECK ((series_id IS NULL) = (occurrence_on IS NULL));
CREATE UNIQUE INDEX crm_campaign_series_occurrence_once ON crm_campaign (series_id, occurrence_on) WHERE series_id IS NOT NULL;
