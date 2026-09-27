-- DOH reporting: checking earlier diagnoses against the rules (Phase 8 follow-up). See docs/interoperability/doh-reporting.md.
--
-- A case report opens when a recorded diagnosis matches an active reportable-condition rule (DiagnosisRecorded). A rule
-- added later does not reach diagnoses recorded before it; staff with doh.settings.manage can ask for the organization's
-- diagnoses recorded within a date range (at most 90 days) to be checked against the rules active at the time. The API
-- runs the check in the background and records what it found; it opens case reports the same way as detection (one per
-- diagnosis). Nothing here encodes which conditions are reportable: the rules stay the organization's configuration.

CREATE TABLE doh_rescan (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid        NOT NULL REFERENCES organization (id),
  -- Calendar dates, both included, in time_zone (recorded_at of the diagnoses is compared in that zone).
  from_date            date        NOT NULL,
  to_date              date        NOT NULL,
  time_zone            text        NOT NULL,
  status               text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  -- Coded diagnoses checked, those matching an active rule, and case reports this check opened (the others were open).
  scanned              integer     NOT NULL DEFAULT 0 CHECK (scanned >= 0),
  matched              integer     NOT NULL DEFAULT 0 CHECK (matched >= 0 AND matched <= scanned),
  opened               integer     NOT NULL DEFAULT 0 CHECK (opened >= 0 AND opened <= matched),
  -- Where a check interrupted (e.g. an API restart) resumes: the last diagnosis checked, in (recorded_at, id) order.
  cursor_recorded_at   timestamptz,
  cursor_diagnosis_id  uuid,
  attempts             integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error           text        CHECK (length(last_error) <= 2000),
  requested_by         uuid        NOT NULL REFERENCES app_user (id),
  requested_at         timestamptz NOT NULL DEFAULT now(),
  started_at           timestamptz,
  heartbeat_at         timestamptz,
  completed_at         timestamptz,
  CHECK (to_date >= from_date AND to_date - from_date < 90),
  CHECK ((cursor_recorded_at IS NULL) = (cursor_diagnosis_id IS NULL)),
  CHECK ((status IN ('completed', 'failed')) = (completed_at IS NOT NULL)),
  UNIQUE (organization_id, id)
);
-- One check at a time per organization.
CREATE UNIQUE INDEX doh_rescan_one_open ON doh_rescan (organization_id) WHERE status IN ('queued', 'running');
CREATE INDEX doh_rescan_recent ON doh_rescan (organization_id, requested_at DESC);
CREATE INDEX doh_rescan_pending ON doh_rescan (requested_at) WHERE status IN ('queued', 'running');

-- Case reports opened by a check (NULL: opened when the diagnosis was recorded).
ALTER TABLE doh_case_report ADD COLUMN rescan_id uuid;
ALTER TABLE doh_case_report ADD FOREIGN KEY (organization_id, rescan_id) REFERENCES doh_rescan (organization_id, id);
CREATE INDEX doh_case_report_rescan ON doh_case_report (rescan_id) WHERE rescan_id IS NOT NULL;

-- The check reads an organization's diagnoses by when they were recorded.
CREATE INDEX diagnosis_recorded_idx ON diagnosis (organization_id, recorded_at, id);
