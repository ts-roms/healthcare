-- Electronic signatures, phase 2 (docs/architecture/electronic-signatures.md): signing a consent form in MyHealth, and a
-- parent or guardian signing for a minor.
--
-- The clinic asks a patient to sign a procedure's consent form (a signature request fixing the wording version); the patient
-- — or the guardian acting for them — reads it in MyHealth and signs by drawing, after confirming their password again. The
-- signed form is stored like the one signed at the clinic (migration 0120). Nothing here decides who may sign for whom or
-- when a person is a minor: the organization chooses the age below under which a representative must sign, and the clinic
-- grants guardians access (migration 0080) by its own procedure.

-- ---- 1. The organization's choices ---------------------------------------------------------------------------------------

CREATE TABLE consent_signing_setting (
  organization_id        uuid        PRIMARY KEY REFERENCES organization (id),
  -- A patient younger than this (full years, on the facility's local date) has the form signed by a parent or guardian, at the
  -- clinic or in MyHealth. 18 is a reference value until the organization confirms its own; null = no age rule.
  minor_age_years        smallint    DEFAULT 18 CHECK (minor_age_years BETWEEN 1 AND 30),
  -- Off until the organization decides: patients (and guardians) may then sign requested forms in MyHealth.
  portal_signing_enabled boolean     NOT NULL DEFAULT false,
  -- Days a request stays open.
  request_valid_days     smallint    NOT NULL DEFAULT 14 CHECK (request_valid_days BETWEEN 1 AND 90),
  updated_by             uuid        NOT NULL REFERENCES app_user (id),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  version                integer     NOT NULL DEFAULT 1 CHECK (version > 0)
);

-- ---- 2. Signature requests ---------------------------------------------------------------------------------------------

CREATE TABLE consent_signature_request (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  facility_id      uuid        NOT NULL,
  patient_id       uuid        NOT NULL,
  definition_id    uuid        NOT NULL,
  -- The wording the patient will read: fixed when the request is made, so a later version never changes what was asked.
  wording_id       uuid        NOT NULL,
  wording_version  integer     NOT NULL CHECK (wording_version > 0),
  -- Whether a representative must sign (the patient was a minor under the organization's rule when it was made).
  representative_required boolean NOT NULL,
  requested_by     uuid        NOT NULL REFERENCES app_user (id),
  requested_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  status           text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'cancelled')),
  signed_document_id uuid,
  signed_at        timestamptz,
  cancelled_by     uuid        REFERENCES app_user (id),
  cancelled_at     timestamptz,
  cancel_reason    text        CHECK (length(btrim(cancel_reason)) BETWEEN 3 AND 500),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id)             REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)              REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, definition_id)           REFERENCES clinic_procedure_definition (organization_id, id),
  FOREIGN KEY (organization_id, wording_id)              REFERENCES clinic_procedure_consent_wording (organization_id, id),
  FOREIGN KEY (organization_id, patient_id, signed_document_id) REFERENCES document (organization_id, patient_id, id),
  CHECK (expires_at > requested_at),
  CHECK ((status = 'signed') = (signed_document_id IS NOT NULL AND signed_at IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL))
);
CREATE INDEX consent_signature_request_patient_idx ON consent_signature_request (organization_id, patient_id, requested_at DESC);
-- One open request per patient and procedure.
CREATE UNIQUE INDEX consent_signature_request_one_open_idx ON consent_signature_request (patient_id, definition_id) WHERE status = 'pending';

-- A request never changes except pending -> signed or pending -> cancelled, once; nothing is deleted.
CREATE FUNCTION consent_signature_request_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'consent_signature_request is append-only' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status <> 'pending'
     OR NEW.status NOT IN ('signed', 'cancelled')
     OR (to_jsonb(NEW) - 'status' - 'signed_document_id' - 'signed_at' - 'cancelled_by' - 'cancelled_at' - 'cancel_reason')
        IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'signed_document_id' - 'signed_at' - 'cancelled_by' - 'cancelled_at' - 'cancel_reason') THEN
    RAISE EXCEPTION 'consent_signature_request changes only from pending to signed or cancelled' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER consent_signature_request_guard BEFORE UPDATE OR DELETE ON consent_signature_request
  FOR EACH ROW EXECUTE FUNCTION consent_signature_request_guard();

-- New care is never filed under a retired (merged) record (migration 0068).
CREATE TRIGGER consent_signature_request_merged_patient BEFORE INSERT ON consent_signature_request
  FOR EACH ROW EXECUTE FUNCTION refuse_record_for_merged_patient();

-- ---- 3. Signature evidence from MyHealth -----------------------------------------------------------------------------------

ALTER TABLE document_signature
  ADD COLUMN request_id         uuid,
  -- The MyHealth account that signed (instead of a member of staff witnessing), and the guardian grant when it signed for another.
  ADD COLUMN portal_account_id  uuid,
  ADD COLUMN proxy_grant_id     uuid,
  -- staff_checked: a member of staff identified the signer; portal_password: the signed-in account holder confirmed their password again.
  ADD COLUMN identity_method    text NOT NULL DEFAULT 'staff_checked' CHECK (identity_method IN ('staff_checked', 'portal_password')),
  ALTER COLUMN witnessed_by DROP NOT NULL,
  ADD FOREIGN KEY (organization_id, request_id)        REFERENCES consent_signature_request (organization_id, id),
  ADD FOREIGN KEY (organization_id, portal_account_id) REFERENCES patient_portal_account (organization_id, id),
  ADD CONSTRAINT document_signature_who CHECK (
    (identity_method = 'staff_checked' AND witnessed_by IS NOT NULL AND portal_account_id IS NULL AND proxy_grant_id IS NULL)
    OR (identity_method = 'portal_password' AND witnessed_by IS NULL AND portal_account_id IS NOT NULL)
  );
