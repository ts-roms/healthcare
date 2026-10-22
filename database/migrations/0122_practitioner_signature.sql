-- Electronic signatures, phase 3 (docs/architecture/electronic-signatures.md): a practitioner's own signature on the
-- medical certificates and referral letters they issue.
--
-- The mark is cosmetic: the authentication of the issuer stays the real control, and nothing here is a cryptographic or
-- legally qualified signature. A practitioner draws their own signature once (only they can set or remove it; strokes, no
-- image upload); the organization decides whether certificates and letters print it (off by default). The signature in
-- force is recorded on the certificate or referral when it is issued, so a later change never alters what an issued
-- document shows, and the stored copy is rendered from that record.

CREATE TABLE practitioner_signature_setting (
  organization_id uuid        PRIMARY KEY REFERENCES organization (id),
  -- Off until the organization decides.
  enabled         boolean     NOT NULL DEFAULT false,
  updated_by      uuid        NOT NULL REFERENCES app_user (id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer     NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE practitioner_signature (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organization (id),
  practitioner_id uuid        NOT NULL,
  -- Compact vector strokes [[[x, y], ...], ...] with x, y in 0..1 inside a 3:1 box. Never logged or exported.
  strokes         jsonb       NOT NULL CHECK (jsonb_typeof(strokes) = 'array' AND jsonb_array_length(strokes) BETWEEN 1 AND 64),
  drawn_by        uuid        NOT NULL REFERENCES app_user (id),
  drawn_at        timestamptz NOT NULL DEFAULT now(),
  withdrawn_at    timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, practitioner_id) REFERENCES practitioner (organization_id, id)
);
-- One signature in force per practitioner; the earlier ones stay for the documents that printed them.
CREATE UNIQUE INDEX practitioner_signature_one_active_idx ON practitioner_signature (practitioner_id) WHERE withdrawn_at IS NULL;

-- A signature never changes except being withdrawn, once; nothing is deleted.
CREATE FUNCTION practitioner_signature_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'practitioner_signature is append-only' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.withdrawn_at IS NOT NULL
     OR NEW.withdrawn_at IS NULL
     OR (to_jsonb(NEW) - 'withdrawn_at') IS DISTINCT FROM (to_jsonb(OLD) - 'withdrawn_at') THEN
    RAISE EXCEPTION 'a practitioner signature changes only by being withdrawn, once' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER practitioner_signature_guard BEFORE UPDATE OR DELETE ON practitioner_signature
  FOR EACH ROW EXECUTE FUNCTION practitioner_signature_guard();

-- ---- the signature in force when a document was issued -------------------------------------------------------------

ALTER TABLE medical_certificate
  ADD COLUMN practitioner_signature_id uuid,
  ADD FOREIGN KEY (organization_id, practitioner_signature_id) REFERENCES practitioner_signature (organization_id, id);
ALTER TABLE referral
  ADD COLUMN practitioner_signature_id uuid,
  ADD FOREIGN KEY (organization_id, practitioner_signature_id) REFERENCES practitioner_signature (organization_id, id);

-- The guards (0068, 0079) now also keep the recorded signature from changing.
CREATE OR REPLACE FUNCTION medical_certificate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'medical certificates are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'void' THEN
    RAISE EXCEPTION 'a voided medical certificate does not change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.organization_id, NEW.facility_id, NEW.patient_id, NEW.encounter_id, NEW.practitioner_id, NEW.certificate_number, NEW.examined_on,
      NEW.purpose, NEW.findings, NEW.recommendations, NEW.rest_from, NEW.rest_to, NEW.issued_at, NEW.issued_by, NEW.practitioner_signature_id)
     IS DISTINCT FROM
     (OLD.organization_id, OLD.facility_id, OLD.patient_id, OLD.encounter_id, OLD.practitioner_id, OLD.certificate_number, OLD.examined_on,
      OLD.purpose, OLD.findings, OLD.recommendations, OLD.rest_from, OLD.rest_to, OLD.issued_at, OLD.issued_by, OLD.practitioner_signature_id) THEN
    RAISE EXCEPTION 'an issued medical certificate is not edited; void it and issue another' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION referral_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'referrals are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.organization_id, NEW.facility_id, NEW.patient_id, NEW.encounter_id, NEW.referring_practitioner_id, NEW.referral_number, NEW.kind,
      NEW.specialty, NEW.to_practitioner_id, NEW.external_provider, NEW.external_facility, NEW.external_contact, NEW.urgency, NEW.reason,
      NEW.clinical_summary, NEW.diagnosis_ids, NEW.issued_at, NEW.issued_by, NEW.practitioner_signature_id)
     IS DISTINCT FROM
     (OLD.organization_id, OLD.facility_id, OLD.patient_id, OLD.encounter_id, OLD.referring_practitioner_id, OLD.referral_number, OLD.kind,
      OLD.specialty, OLD.to_practitioner_id, OLD.external_provider, OLD.external_facility, OLD.external_contact, OLD.urgency, OLD.reason,
      OLD.clinical_summary, OLD.diagnosis_ids, OLD.issued_at, OLD.issued_by, OLD.practitioner_signature_id) THEN
    RAISE EXCEPTION 'a referral is not edited; cancel it and refer again' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('declined', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'a % referral does not change', OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT ((OLD.status = 'sent' AND NEW.status IN ('sent', 'accepted', 'declined', 'completed', 'cancelled'))
       OR (OLD.status = 'accepted' AND NEW.status IN ('accepted', 'completed', 'cancelled'))) THEN
    RAISE EXCEPTION 'referral status % cannot become %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.responded_at IS NOT NULL AND (NEW.responded_at, NEW.responded_by, NEW.response_note) IS DISTINCT FROM (OLD.responded_at, OLD.responded_by, OLD.response_note) THEN
    RAISE EXCEPTION 'an answer to a referral is not changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
