-- Guardian and dependent access in MyHealth: a person with their own MyHealth account may act for another person's record.
-- See docs/architecture/portal-app.md ("Guardians and dependents") and docs/domains/patient.md.
--
-- The clinic grants it after checking, in person and by its own procedure, who the person is and by what right they act
-- (a parent of a child, a legal guardian, a person the patient authorized). The platform encodes no legal rule about age of
-- majority, guardianship or authorization: staff record the basis and what they checked, and the grant can be ended by
-- staff, by the person acted for (if they have an account) or by the guardian. Access exists only while the grant is live,
-- the guardian's own account can sign in, and the dependent's own portal-access consent is in effect.

CREATE TABLE portal_proxy_grant (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL,
  -- The person who acts (has their own MyHealth account) and the person acted for.
  guardian_patient_id      uuid        NOT NULL,
  dependent_patient_id     uuid        NOT NULL,
  relationship             text        NOT NULL CHECK (relationship IN ('parent', 'legal_guardian', 'caregiver', 'spouse_or_partner', 'adult_child', 'other')),
  -- By what right, in the clinic's own procedure: the platform does not decide this.
  basis                    text        NOT NULL CHECK (basis IN ('parent_of_minor', 'legal_guardian', 'authorized_by_patient', 'other_authorized')),
  -- "view": read the record, messages and bills. "act": also book and change visits, write messages, pay, ask for records.
  scopes                   text[]      NOT NULL CHECK (scopes <@ ARRAY['view', 'act']::text[] AND 'view' = ANY (scopes)),
  -- What was checked (documents seen, who verified): a few words, no clinical detail.
  verification_note        text        NOT NULL CHECK (length(btrim(verification_note)) BETWEEN 5 AND 500),
  granted_by               uuid        NOT NULL REFERENCES app_user (id),
  granted_at               timestamptz NOT NULL DEFAULT now(),
  expires_at               timestamptz,
  revoked_at               timestamptz,
  revoked_by_user          uuid        REFERENCES app_user (id),
  -- The MyHealth account that ended it (the person acted for, or the guardian giving up access).
  revoked_by_portal_account uuid,
  revoked_reason           text        CHECK (revoked_reason IS NULL OR length(btrim(revoked_reason)) BETWEEN 3 AND 500),
  FOREIGN KEY (organization_id, guardian_patient_id)  REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, dependent_patient_id) REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, revoked_by_portal_account) REFERENCES patient_portal_account (organization_id, id),
  CHECK (guardian_patient_id <> dependent_patient_id),
  CHECK (expires_at IS NULL OR expires_at > granted_at),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CHECK (revoked_by_user IS NULL OR revoked_by_portal_account IS NULL),
  CHECK (revoked_at IS NOT NULL OR (revoked_by_user IS NULL AND revoked_by_portal_account IS NULL))
);

-- One live grant per pair; a person can be granted again after it ended.
CREATE UNIQUE INDEX portal_proxy_grant_live_uq ON portal_proxy_grant (guardian_patient_id, dependent_patient_id) WHERE revoked_at IS NULL;
CREATE INDEX portal_proxy_grant_dependent_idx ON portal_proxy_grant (dependent_patient_id, granted_at DESC);

-- A message a guardian wrote for the patient is marked, so the clinic knows who it is answering.
ALTER TABLE patient_message ADD COLUMN via_guardian boolean NOT NULL DEFAULT false;

INSERT INTO permission (key, description)
VALUES ('patient.portal.proxy.manage', 'Give, and end, a guardian''s or caregiver''s access to another patient''s MyHealth after checking their authority');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'patient.portal.proxy.manage' FROM role r WHERE r.key IN ('org_admin', 'receptionist', 'records_officer') AND r.is_system
ON CONFLICT DO NOTHING;
