-- MyHealth dental records: opt-in per organization (docs/domains/dental.md, "Dental records in MyHealth").
--
-- Off by default. While off, the patient portal shows nothing dental. When on, patients see only their treatment plans
-- (items, their decision, status), completed procedures and the current tooth chart — never examination notes,
-- periodontal measurements, images, remarks or anything entered in error. What is patient-facing is decided in code
-- (libs/dental/src/lib/portal/dental-patient-access.ts); this table only holds the organization's choice.
-- Changes are optimistic (`version`) and audited with before/after (`dental.settings.portal`).

CREATE TABLE dental_organization_setting (
  organization_id        uuid        PRIMARY KEY REFERENCES organization (id),
  portal_dental_records  boolean     NOT NULL DEFAULT false,
  version                integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by             uuid        NOT NULL REFERENCES app_user (id),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
