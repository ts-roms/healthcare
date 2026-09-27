-- DOH reporting: adapter stubs (Phase 8). See docs/interoperability/doh-reporting.md.
--
-- No official DOH reporting specification (disease surveillance or statistical reporting) is on record. Nothing here
-- encodes a notifiable-disease list, case definitions, reporting deadlines or message formats:
--   * which diagnoses are reportable is configured by the organization from the official issuances it follows;
--   * a matching diagnosis opens a case report for staff review; a confirmed report is either recorded as reported
--     through DOH's own channel (with its reference) or, once an adapter exists, sent by the integration worker.

-- Organization-configured rules: an ICD-10 code or code prefix → the report category staff use (their wording).
CREATE TABLE doh_reportable_rule (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  code_system_key  text        NOT NULL DEFAULT 'icd-10' CHECK (code_system_key IN ('icd-10')),
  -- "A90" matches A90 and A90.x; stored upper-case without spaces.
  code_prefix      text        NOT NULL CHECK (code_prefix ~ '^[A-Z][0-9A-Z]{1,2}(\.[0-9A-Z]{0,4})?$'),
  category         text        NOT NULL CHECK (length(btrim(category)) BETWEEN 1 AND 120),
  -- Where the organization took the rule from (e.g. the issuance it follows); free text for reviewers.
  source_note      text        CHECK (length(source_note) <= 500),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX doh_reportable_rule_active ON doh_reportable_rule (organization_id, code_system_key, code_prefix) WHERE status = 'active';

-- The facility's DOH health facility code, as issued (not verified with DOH).
CREATE TABLE doh_facility_setting (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  facility_id      uuid        NOT NULL,
  facility_code    text        NOT NULL CHECK (length(btrim(facility_code)) BETWEEN 1 AND 40),
  updated_by       uuid        NOT NULL REFERENCES app_user (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (facility_id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id)
);

-- One case report per diagnosis that matched a rule. Snapshots keep what matched even if the rule changes later.
CREATE TABLE doh_case_report (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL REFERENCES organization (id),
  facility_id         uuid        NOT NULL,
  patient_id          uuid        NOT NULL,
  encounter_id        uuid        NOT NULL,
  diagnosis_id        uuid        NOT NULL,
  rule_id             uuid        NOT NULL,
  category            text        NOT NULL,
  diagnosis_code      text        NOT NULL,
  diagnosis_display   text        NOT NULL,
  status              text        NOT NULL DEFAULT 'pending_review'
                                  CHECK (status IN ('pending_review', 'queued', 'reported', 'rejected', 'failed', 'dismissed')),
  -- How it left: through DOH's own channel (recorded by staff) or through an adapter (integration_exchange).
  reported_via        text        CHECK (reported_via IN ('external_channel', 'adapter')),
  external_reference  text        CHECK (length(external_reference) <= 80),
  exchange_id         uuid        REFERENCES integration_exchange (id),
  status_reason       text        CHECK (length(status_reason) <= 500),
  detected_at         timestamptz NOT NULL DEFAULT now(),
  reviewed_by         uuid        REFERENCES app_user (id),
  reviewed_at         timestamptz,
  version             integer     NOT NULL DEFAULT 1,
  UNIQUE (diagnosis_id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)  REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, rule_id)     REFERENCES doh_reportable_rule (organization_id, id),
  CHECK (status <> 'dismissed' OR status_reason IS NOT NULL),
  CHECK (status <> 'reported' OR (reported_via IS NOT NULL AND external_reference IS NOT NULL))
);
CREATE INDEX doh_case_report_status ON doh_case_report (organization_id, status, detected_at);

-- ---- permissions --------------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('doh.report.manage',    'Review disease case reports: confirm, record as reported, dismiss, submit'),
  ('doh.settings.manage',  'Configure reportable conditions and the facility''s DOH health facility code');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, p.key FROM role r CROSS JOIN permission p
WHERE r.key = 'org_admin' AND r.is_system AND p.key LIKE 'doh.%'
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'doh.report.manage' FROM role r
WHERE r.key IN ('records_officer', 'physician') AND r.is_system
ON CONFLICT DO NOTHING;
