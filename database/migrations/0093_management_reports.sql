-- Scheduled management reports (docs/architecture/management-dashboard.md, "Scheduled reports"): an administrator
-- schedules a weekly or monthly set of the dashboard's export tables for a facility scope; the API produces each
-- period's CSV files once (the same export the screen uses, with the schedule owner's permissions), stores them as
-- documents and tells the named recipients in-app (and by email, without figures). Counts and amounts only, as on the
-- dashboard: small patient counts stay suppressed and revenue tables need billing reporting.

INSERT INTO permission (key, description)
VALUES ('management.report.manage', 'Schedule management reports: cadence, tables, facility scope and recipients');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'management.report.manage' FROM role r
WHERE r.key = 'org_admin' AND r.is_system
ON CONFLICT DO NOTHING;

ALTER TABLE document DROP CONSTRAINT document_category_check;
ALTER TABLE document ADD CONSTRAINT document_category_check CHECK (category IN
  ('consent_form', 'identification', 'medical_certificate', 'laboratory_report', 'imaging',
   'referral_letter', 'prescription', 'clinical_attachment', 'billing', 'other', 'record_copy', 'management_report'));

CREATE TABLE management_report_schedule (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES organization (id),
  -- Null: every facility the owner may report on.
  facility_id        uuid,
  name               text        NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  cadence            text        NOT NULL CHECK (cadence IN ('weekly', 'monthly')),
  -- Export tables of the dashboard, as the API names them; at least one.
  tables             text[]      NOT NULL CHECK (cardinality(tables) BETWEEN 1 AND 20),
  -- Staff users told when a period's report is ready; each is re-checked for the permissions the report needs.
  recipient_user_ids uuid[]      NOT NULL CHECK (cardinality(recipient_user_ids) BETWEEN 1 AND 50),
  -- The report is produced with this person's permissions (scope and revenue), re-resolved at each run.
  owner_user_id      uuid        NOT NULL REFERENCES app_user (id),
  status             text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  version            integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid        NOT NULL REFERENCES app_user (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id)
);
CREATE INDEX management_report_schedule_org_idx ON management_report_schedule (organization_id, status);

-- One row per schedule and period: produced once however many instances run the job (the unique key), resumed when
-- an earlier attempt stopped half-way (status 'producing').
CREATE TABLE management_report (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  schedule_id      uuid        NOT NULL,
  period_from      date        NOT NULL,
  period_to        date        NOT NULL CHECK (period_to >= period_from),
  facility_id      uuid,
  status           text        NOT NULL DEFAULT 'producing' CHECK (status IN ('producing', 'produced', 'partial', 'failed')),
  -- Tables the run could not produce (e.g. revenue without billing reporting), with the reason.
  withheld         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  error            text,
  started_at       timestamptz NOT NULL DEFAULT now(),
  produced_at      timestamptz,
  -- Recipients told (user ids), so a resumed run does not tell them twice.
  notified_user_ids uuid[]     NOT NULL DEFAULT '{}',
  UNIQUE (schedule_id, period_from),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, schedule_id) REFERENCES management_report_schedule (organization_id, id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id)
);
CREATE INDEX management_report_schedule_idx ON management_report (schedule_id, period_from DESC);

-- One stored CSV per table of a run. The document id is chosen when the run starts, so a retry stores the same file once.
CREATE TABLE management_report_file (
  report_id        uuid        NOT NULL,
  organization_id  uuid        NOT NULL,
  "table"          text        NOT NULL,
  -- The stored CSV: set together with stored_at once the document exists (the file row is claimed before the export runs).
  document_id      uuid,
  stored_at        timestamptz,
  PRIMARY KEY (report_id, "table"),
  FOREIGN KEY (organization_id, report_id) REFERENCES management_report (organization_id, id),
  FOREIGN KEY (organization_id, document_id) REFERENCES document (organization_id, id),
  CHECK ((document_id IS NULL) = (stored_at IS NULL))
);
