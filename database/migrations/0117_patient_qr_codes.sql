-- Patient QR codes (docs/domains/patient.md, "Patient QR codes").
--
-- A QR code on a patient card or wristband that staff scan to open the patient record or check the patient in. The
-- organization chooses whether the feature is on, whether a code is issued at registration, and what the code
-- encodes. Nothing clinical or demographic is ever encoded: either an opaque, revocable token (default) or the patient
-- number. A scan only tells an authenticated, authorized member of staff which record to open; it grants nothing.

-- ---- 1. The organization's choice ---------------------------------------------------------------------------------

CREATE TABLE patient_qr_setting (
  organization_id       uuid        PRIMARY KEY REFERENCES organization (id),
  -- Off until the organization decides (and has reviewed the card handling with its Data Protection Officer).
  enabled               boolean     NOT NULL DEFAULT false,
  -- Issue a code when a patient is registered (the registering person may still decline for one patient).
  issue_at_registration boolean     NOT NULL DEFAULT true,
  -- token: an opaque random value, revocable (a lost card) and meaningless to anyone without access to the platform.
  -- patient_number: the patient number as text; easier to read off a card, but only accepted while a code is active.
  content               text        NOT NULL DEFAULT 'token' CHECK (content IN ('token', 'patient_number')),
  updated_by            uuid        NOT NULL REFERENCES app_user (id),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer     NOT NULL DEFAULT 1 CHECK (version > 0)
);

-- ---- 2. Issued codes ----------------------------------------------------------------------------------------------

CREATE TABLE patient_qr_code (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organization (id),
  patient_id      uuid        NOT NULL,
  -- What was encoded when it was issued (the setting may change later without altering codes already on cards).
  content         text        NOT NULL CHECK (content IN ('token', 'patient_number')),
  -- Random, 26 base32 characters. Present for both contents so a code can always be told apart and revoked.
  token           text        NOT NULL CHECK (token ~ '^[A-Z2-7]{26}$'),
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  issued_via      text        NOT NULL CHECK (issued_via IN ('registration', 'patient_record')),
  issued_by       uuid        NOT NULL REFERENCES app_user (id),
  issued_at       timestamptz NOT NULL DEFAULT now(),
  revoked_by      uuid        REFERENCES app_user (id),
  revoked_at      timestamptz,
  revoke_reason   text        CHECK (length(btrim(revoke_reason)) BETWEEN 5 AND 500),
  UNIQUE (organization_id, id),
  UNIQUE (token),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);
-- One active code per patient; history stays.
CREATE UNIQUE INDEX patient_qr_code_one_active_idx ON patient_qr_code (patient_id) WHERE status = 'active';
CREATE INDEX patient_qr_code_patient_idx ON patient_qr_code (organization_id, patient_id, issued_at DESC);

-- A code is never deleted or edited; the only change is active -> revoked, once.
CREATE FUNCTION patient_qr_code_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'patient_qr_code is append-only' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status <> 'active'
     OR NEW.status <> 'revoked'
     OR (NEW.id, NEW.organization_id, NEW.patient_id, NEW.content, NEW.token, NEW.issued_via, NEW.issued_by, NEW.issued_at)
        IS DISTINCT FROM (OLD.id, OLD.organization_id, OLD.patient_id, OLD.content, OLD.token, OLD.issued_via, OLD.issued_by, OLD.issued_at) THEN
    RAISE EXCEPTION 'a patient QR code can only be revoked' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER patient_qr_code_guard_update
  BEFORE UPDATE ON patient_qr_code
  FOR EACH ROW EXECUTE FUNCTION patient_qr_code_guard();
CREATE TRIGGER patient_qr_code_guard_delete
  BEFORE DELETE ON patient_qr_code
  FOR EACH ROW EXECUTE FUNCTION patient_qr_code_guard();
CREATE TRIGGER patient_qr_code_no_truncate
  BEFORE TRUNCATE ON patient_qr_code
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();

-- No new code under a retired (merged) record.
CREATE TRIGGER patient_qr_code_not_for_merged_patient
  BEFORE INSERT ON patient_qr_code
  FOR EACH ROW EXECUTE FUNCTION refuse_record_for_merged_patient();

-- ---- 3. Permissions -----------------------------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('patient.qr.issue',  'Issue, print and revoke a patient''s QR code'),
  ('patient.qr.manage', 'Turn patient QR codes on or off and choose what they encode');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'patient.qr.issue' FROM role r
WHERE r.key IN ('org_admin', 'receptionist', 'records_officer', 'nurse') AND r.is_system
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'patient.qr.manage' FROM role r WHERE r.key = 'org_admin' AND r.is_system
ON CONFLICT DO NOTHING;
