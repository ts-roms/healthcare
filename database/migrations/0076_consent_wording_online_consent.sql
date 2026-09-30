-- Online consent in MyHealth: a patient gives certain consents themselves, in front of the organization's own wording.
-- See docs/architecture/portal-app.md ("Privacy and consents") and docs/domains/patient.md.
--
-- The platform ships no consent wording: an organization writes its own (and its acknowledgement statement), and a type
-- is offered online only while the latest version says so. Each version is immutable; a consent given online records
-- which version the patient saw. Only consents the patient may also withdraw online can be given online; consent to
-- data processing and to general treatment, and portal access itself, stay with the clinic.

CREATE TABLE consent_text (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  consent_type     text        NOT NULL CHECK (consent_type IN ('telemedicine', 'data_sharing_hmo', 'data_sharing_philhealth', 'research')),
  version          integer     NOT NULL CHECK (version > 0),
  -- Whether patients are offered this consent online from this version (false stops offering it).
  offered          boolean     NOT NULL,
  title            text,
  body             text,
  acknowledgement  text,
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, consent_type, version),
  UNIQUE (organization_id, id),
  CHECK (
    NOT offered OR (
      length(btrim(title)) BETWEEN 1 AND 120 AND length(btrim(body)) BETWEEN 1 AND 20000 AND length(btrim(acknowledgement)) BETWEEN 1 AND 500
    )
  )
);

CREATE TRIGGER consent_text_append_only BEFORE UPDATE OR DELETE ON consent_text
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

ALTER TABLE patient_consent
  ADD COLUMN consent_text_id uuid,
  ADD CONSTRAINT patient_consent_text_fk FOREIGN KEY (organization_id, consent_text_id) REFERENCES consent_text (organization_id, id),
  -- The wording a patient saw is recorded only on a consent they gave online.
  ADD CONSTRAINT patient_consent_text_only_online CHECK (consent_text_id IS NULL OR (decision = 'granted' AND captured_via = 'electronic')),
  DROP CONSTRAINT patient_consent_patient_withdrawal,
  -- Through MyHealth a patient records a withdrawal, or a grant made against a wording version, always electronically.
  ADD CONSTRAINT patient_consent_patient_decision CHECK (
    recorded_by_portal_account IS NULL OR (
      captured_via = 'electronic' AND (decision = 'withdrawn' OR (decision = 'granted' AND consent_text_id IS NOT NULL))
    )
  );

INSERT INTO permission (key, description)
VALUES ('consent.wording.manage', 'Write the organization''s consent wording that patients read before giving a consent online');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'consent.wording.manage' FROM role r WHERE r.key = 'org_admin' AND r.is_system
ON CONFLICT DO NOTHING;
