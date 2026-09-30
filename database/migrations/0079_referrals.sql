-- Referrals (docs/domains/clinic.md, "Referrals"). A practitioner refers a patient from a consultation, either to a
-- practitioner of the organization (internal: they accept or decline, an appointment may be linked, and they complete
-- it) or to an outside provider named as the practitioner writes it (external: the reply is recorded when it comes
-- back). Numbered per organization (RF########); what the referrer wrote never changes; the letter is a generated
-- document whose id is the referral's. No referral form, network or electronic exchange of any agency or insurer is
-- assumed; sending to an outside provider happens through the channel the practitioner chooses.

CREATE TABLE referral_number_sequence (
  organization_id  uuid   PRIMARY KEY REFERENCES organization (id),
  next_value       bigint NOT NULL CHECK (next_value > 0)
);

CREATE TABLE referral (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            uuid        NOT NULL REFERENCES organization (id),
  facility_id                uuid        NOT NULL,
  patient_id                 uuid        NOT NULL,
  encounter_id               uuid        NOT NULL,
  referring_practitioner_id  uuid        NOT NULL,
  referral_number            text        NOT NULL CHECK (referral_number ~ '^RF[0-9]{8}$'),
  kind                       text        NOT NULL CHECK (kind IN ('internal', 'external')),
  specialty                  text        CHECK (length(btrim(specialty)) BETWEEN 2 AND 120),
  -- Internal: the practitioner referred to.
  to_practitioner_id         uuid,
  -- External: the provider as the referrer names it (not verified), and how to reach them.
  external_provider          text        CHECK (length(btrim(external_provider)) BETWEEN 2 AND 200),
  external_facility          text        CHECK (length(btrim(external_facility)) BETWEEN 2 AND 200),
  external_contact           text        CHECK (length(btrim(external_contact)) BETWEEN 3 AND 200),
  urgency                    text        NOT NULL CHECK (urgency IN ('routine', 'urgent', 'emergency')),
  reason                     text        NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  clinical_summary           text        CHECK (length(clinical_summary) <= 4000),
  -- Diagnoses of the consultation the letter lists.
  diagnosis_ids              uuid[]      NOT NULL DEFAULT '{}',
  status                     text        NOT NULL DEFAULT 'sent'
                                         CHECK (status IN ('sent', 'accepted', 'declined', 'completed', 'cancelled')),
  issued_at                  timestamptz NOT NULL DEFAULT now(),
  issued_by                  uuid        NOT NULL REFERENCES app_user (id),
  -- The receiving practitioner's answer (internal).
  responded_at               timestamptz,
  responded_by               uuid        REFERENCES app_user (id),
  response_note              text        CHECK (length(btrim(response_note)) BETWEEN 3 AND 1000),
  -- The appointment booked for it (internal: with the practitioner referred to).
  appointment_id             uuid,
  completed_at               timestamptz,
  completed_by               uuid        REFERENCES app_user (id),
  -- What came of it: the receiving practitioner's note, or the outside provider's reply as recorded.
  outcome_note               text        CHECK (length(btrim(outcome_note)) BETWEEN 3 AND 2000),
  -- An outside provider's reply stored as a document of the patient.
  reply_document_id          uuid,
  cancelled_at               timestamptz,
  cancelled_by               uuid        REFERENCES app_user (id),
  cancel_reason              text        CHECK (length(btrim(cancel_reason)) BETWEEN 5 AND 500),
  version                    integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, referral_number),
  FOREIGN KEY (organization_id, facility_id)                REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)                 REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, encounter_id)               REFERENCES encounter (organization_id, id),
  FOREIGN KEY (patient_id, encounter_id)                    REFERENCES encounter (patient_id, id),
  FOREIGN KEY (organization_id, referring_practitioner_id)  REFERENCES practitioner (organization_id, id),
  FOREIGN KEY (organization_id, to_practitioner_id)         REFERENCES practitioner (organization_id, id),
  FOREIGN KEY (patient_id, appointment_id)                  REFERENCES appointment (patient_id, id),
  FOREIGN KEY (organization_id, patient_id, reply_document_id) REFERENCES document (organization_id, patient_id, id),
  CHECK ((kind = 'internal') = (to_practitioner_id IS NOT NULL)),
  CHECK ((kind = 'external') = (external_provider IS NOT NULL)),
  CHECK (kind = 'external' OR (external_facility IS NULL AND external_contact IS NULL)),
  CHECK (to_practitioner_id IS NULL OR to_practitioner_id <> referring_practitioner_id),
  -- Only an internal referral is answered and gets an appointment; an outside reply comes with an external one.
  CHECK (kind = 'internal' OR (responded_at IS NULL AND appointment_id IS NULL)),
  CHECK (kind = 'external' OR reply_document_id IS NULL),
  CHECK ((responded_at IS NULL) = (responded_by IS NULL)),
  CHECK (status NOT IN ('accepted', 'declined') OR responded_at IS NOT NULL),
  CHECK (status <> 'declined' OR response_note IS NOT NULL),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CHECK ((completed_at IS NULL) = (completed_by IS NULL)),
  CHECK (status <> 'completed' OR outcome_note IS NOT NULL),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK ((cancelled_at IS NULL) = (cancelled_by IS NULL) AND (cancelled_at IS NULL) = (cancel_reason IS NULL))
);

CREATE INDEX referral_encounter ON referral (encounter_id);
CREATE INDEX referral_patient ON referral (organization_id, patient_id, issued_at DESC);
CREATE INDEX referral_to_practitioner ON referral (to_practitioner_id, status) WHERE to_practitioner_id IS NOT NULL;
CREATE INDEX referral_open ON referral (organization_id, status, issued_at) WHERE status IN ('sent', 'accepted');

-- What the referrer wrote never changes; status only moves forward (sent → accepted | declined | completed | cancelled;
-- accepted → completed | cancelled); a declined, completed or cancelled referral no longer changes. Never deleted.
CREATE FUNCTION referral_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'referrals are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.organization_id, NEW.facility_id, NEW.patient_id, NEW.encounter_id, NEW.referring_practitioner_id, NEW.referral_number, NEW.kind,
      NEW.specialty, NEW.to_practitioner_id, NEW.external_provider, NEW.external_facility, NEW.external_contact, NEW.urgency, NEW.reason,
      NEW.clinical_summary, NEW.diagnosis_ids, NEW.issued_at, NEW.issued_by)
     IS DISTINCT FROM
     (OLD.organization_id, OLD.facility_id, OLD.patient_id, OLD.encounter_id, OLD.referring_practitioner_id, OLD.referral_number, OLD.kind,
      OLD.specialty, OLD.to_practitioner_id, OLD.external_provider, OLD.external_facility, OLD.external_contact, OLD.urgency, OLD.reason,
      OLD.clinical_summary, OLD.diagnosis_ids, OLD.issued_at, OLD.issued_by) THEN
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

CREATE TRIGGER referral_history BEFORE UPDATE OR DELETE ON referral
  FOR EACH ROW EXECUTE FUNCTION referral_guard();
