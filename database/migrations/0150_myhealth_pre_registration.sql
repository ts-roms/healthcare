-- Pre-registration from MyHealth (docs/domains/kiosk.md, "Pre-registration from MyHealth").
--
-- A person who is not yet a patient can send their details from the MyHealth app before their first visit. It is the
-- kiosk's staged registration with another source: nothing becomes a patient, an account or access on its own. The
-- submission is sealed (integration key ring), reception reviews it with the Patient Master's possible duplicates and
-- approves it through the ordinary registration, links it to an existing patient, or declines it, after checking the
-- person's identification; the sealed payload is erased on any decision and when it expires. MyHealth access still
-- starts only with the clinic's own activation code, after approval.
--
-- Off until the organization turns it on, with its own privacy notice (the platform ships none) and how long an
-- unreviewed request is kept.

ALTER TABLE kiosk_registration ADD COLUMN source text NOT NULL DEFAULT 'kiosk' CHECK (source IN ('kiosk', 'myhealth'));
-- The privacy notice version the person accepted (MyHealth; a kiosk shows its own notice).
ALTER TABLE kiosk_registration ADD COLUMN notice_version integer CHECK (notice_version IS NULL OR notice_version >= 1);
ALTER TABLE kiosk_registration ALTER COLUMN device_id DROP NOT NULL;
ALTER TABLE kiosk_registration ALTER COLUMN session_id DROP NOT NULL;
ALTER TABLE kiosk_registration ADD CONSTRAINT kiosk_registration_source_origin CHECK (
  (source = 'kiosk' AND device_id IS NOT NULL AND session_id IS NOT NULL)
  OR (source = 'myhealth' AND device_id IS NULL AND session_id IS NULL AND notice_version IS NOT NULL)
);
ALTER TABLE kiosk_registration DROP CONSTRAINT kiosk_registration_reference_check;
ALTER TABLE kiosk_registration ADD CONSTRAINT kiosk_registration_reference_check CHECK (
  (source = 'kiosk' AND reference ~ '^KR-[A-HJ-NP-Z2-9]{6}$') OR (source = 'myhealth' AND reference ~ '^MR-[A-HJ-NP-Z2-9]{6}$')
);
CREATE INDEX kiosk_registration_myhealth_recent ON kiosk_registration (organization_id, submitted_at) WHERE source = 'myhealth';

-- The organization's choice: whether MyHealth offers pre-registration, its privacy notice (versioned: a new text is a
-- new version, and each request records the version accepted), and how long a request waits for review.
CREATE TABLE pre_registration_setting (
  organization_id uuid        PRIMARY KEY REFERENCES organization (id),
  enabled         boolean     NOT NULL DEFAULT false,
  notice_text     text        CHECK (notice_text IS NULL OR length(btrim(notice_text)) BETWEEN 20 AND 5000),
  notice_version  integer     NOT NULL DEFAULT 0 CHECK (notice_version >= 0),
  retention_days  integer     NOT NULL DEFAULT 7 CHECK (retention_days BETWEEN 1 AND 30),
  updated_by      uuid        REFERENCES app_user (id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer     NOT NULL DEFAULT 1,
  -- Turned on only with a notice to show.
  CHECK (NOT enabled OR (notice_text IS NOT NULL AND notice_version >= 1))
);
