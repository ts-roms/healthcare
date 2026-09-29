-- Medical certificates and patient records requests. See docs/domains/clinic.md ("Medical certificates") and
-- docs/domains/records-requests.md.
--
-- 1. Medical certificates: issued from a signed consultation (in person or online) by its responsible practitioner,
--    numbered per organization (MC########), immutable once issued; a mistaken one is voided with a reason and a new
--    one issued. The printable copy is a generated document whose id is the certificate's (stored once). The platform
--    supplies no wording required by any agency: the practitioner writes the purpose, findings and recommendations.
-- 2. Records requests: a patient asks in MyHealth for copies of their records (what, which period, why); the records
--    office reviews it and shares documents from the patient's record, or declines with a reason told to the patient;
--    the patient may withdraw while it is open. No response deadline is encoded (the organization's Data Privacy Act
--    procedures apply; a compliance dependency). Shared documents are listed for the patient to download (append-only).

-- ---- 1. medical certificates ---------------------------------------------------------------------------------

CREATE TABLE medical_certificate_number_sequence (
  organization_id  uuid   PRIMARY KEY REFERENCES organization (id),
  next_value       bigint NOT NULL CHECK (next_value > 0)
);

CREATE TABLE medical_certificate (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL REFERENCES organization (id),
  facility_id         uuid        NOT NULL,
  patient_id          uuid        NOT NULL,
  encounter_id        uuid        NOT NULL,
  practitioner_id     uuid        NOT NULL,
  certificate_number  text        NOT NULL CHECK (certificate_number ~ '^MC[0-9]{8}$'),
  -- The consultation's local date (facility time zone).
  examined_on         date        NOT NULL,
  purpose             text        NOT NULL CHECK (length(btrim(purpose)) BETWEEN 3 AND 200),
  findings            text        NOT NULL CHECK (length(btrim(findings)) BETWEEN 3 AND 2000),
  recommendations     text        CHECK (length(recommendations) <= 2000),
  rest_from           date,
  rest_to             date,
  status              text        NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'void')),
  issued_at           timestamptz NOT NULL DEFAULT now(),
  issued_by           uuid        NOT NULL REFERENCES app_user (id),
  voided_at           timestamptz,
  voided_by           uuid        REFERENCES app_user (id),
  void_reason         text        CHECK (length(btrim(void_reason)) BETWEEN 5 AND 500),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, certificate_number),
  FOREIGN KEY (organization_id, facility_id)     REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)      REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, encounter_id)    REFERENCES encounter (organization_id, id),
  FOREIGN KEY (patient_id, encounter_id)         REFERENCES encounter (patient_id, id),
  FOREIGN KEY (organization_id, practitioner_id) REFERENCES practitioner (organization_id, id),
  CHECK ((rest_from IS NULL) = (rest_to IS NULL)),
  CHECK (rest_to IS NULL OR (rest_to >= rest_from AND rest_to - rest_from <= 365)),
  CHECK ((status = 'void') = (voided_at IS NOT NULL)),
  CHECK ((voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL))
);

CREATE INDEX medical_certificate_encounter ON medical_certificate (encounter_id);
CREATE INDEX medical_certificate_patient ON medical_certificate (organization_id, patient_id, issued_at DESC);

-- Issued content never changes; a certificate is voided once, and never deleted.
CREATE FUNCTION medical_certificate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'medical certificates are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'void' THEN
    RAISE EXCEPTION 'a voided medical certificate does not change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.organization_id, NEW.facility_id, NEW.patient_id, NEW.encounter_id, NEW.practitioner_id, NEW.certificate_number, NEW.examined_on,
      NEW.purpose, NEW.findings, NEW.recommendations, NEW.rest_from, NEW.rest_to, NEW.issued_at, NEW.issued_by)
     IS DISTINCT FROM
     (OLD.organization_id, OLD.facility_id, OLD.patient_id, OLD.encounter_id, OLD.practitioner_id, OLD.certificate_number, OLD.examined_on,
      OLD.purpose, OLD.findings, OLD.recommendations, OLD.rest_from, OLD.rest_to, OLD.issued_at, OLD.issued_by) THEN
    RAISE EXCEPTION 'an issued medical certificate is not edited; void it and issue another' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER medical_certificate_history BEFORE UPDATE OR DELETE ON medical_certificate
  FOR EACH ROW EXECUTE FUNCTION medical_certificate_guard();

-- ---- 2. records requests -------------------------------------------------------------------------------------

CREATE TABLE records_request_number_sequence (
  organization_id  uuid   PRIMARY KEY REFERENCES organization (id),
  next_value       bigint NOT NULL CHECK (next_value > 0)
);

CREATE TABLE records_request (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL REFERENCES organization (id),
  patient_id          uuid        NOT NULL,
  request_number      text        NOT NULL CHECK (request_number ~ '^RR[0-9]{8}$'),
  -- What the patient asks for (at least one).
  scope               text[]      NOT NULL CHECK (cardinality(scope) BETWEEN 1 AND 7
                                    AND scope <@ ARRAY['consultations', 'laboratory', 'prescriptions', 'dental', 'imaging', 'certificates', 'other']::text[]),
  period_from         date,
  period_to           date,
  details             text        CHECK (length(details) <= 1000),
  purpose             text        CHECK (length(purpose) <= 300),
  status              text        NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'in_review', 'fulfilled', 'declined', 'withdrawn')),
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  -- The MyHealth account that sent it.
  portal_account_id   uuid        NOT NULL REFERENCES patient_portal_account (id),
  review_started_at   timestamptz,
  review_started_by   uuid        REFERENCES app_user (id),
  -- What the records office tells the patient when it answers (fulfilled: a note; declined: the reason).
  response_note       text        CHECK (length(btrim(response_note)) BETWEEN 3 AND 1000),
  closed_at           timestamptz,
  closed_by           uuid        REFERENCES app_user (id),
  version             integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, request_number),
  UNIQUE (patient_id, id),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id),
  CHECK ((period_from IS NULL OR period_to IS NULL) OR period_to >= period_from),
  CHECK ((review_started_at IS NULL) = (review_started_by IS NULL)),
  CHECK ((status IN ('fulfilled', 'declined', 'withdrawn')) = (closed_at IS NOT NULL)),
  -- Staff close fulfilled and declined requests; the patient withdraws their own.
  CHECK ((status IN ('fulfilled', 'declined')) = (closed_by IS NOT NULL)),
  CHECK (status <> 'declined' OR response_note IS NOT NULL)
);

CREATE INDEX records_request_open ON records_request (organization_id, status, submitted_at);
CREATE INDEX records_request_patient ON records_request (patient_id, submitted_at DESC);

CREATE FUNCTION records_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'records requests are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.organization_id, NEW.patient_id, NEW.request_number, NEW.scope, NEW.period_from, NEW.period_to, NEW.details, NEW.purpose,
      NEW.submitted_at, NEW.portal_account_id)
     IS DISTINCT FROM
     (OLD.organization_id, OLD.patient_id, OLD.request_number, OLD.scope, OLD.period_from, OLD.period_to, OLD.details, OLD.purpose,
      OLD.submitted_at, OLD.portal_account_id) THEN
    RAISE EXCEPTION 'what a patient asked for is not changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('fulfilled', 'declined', 'withdrawn') THEN
    RAISE EXCEPTION 'a closed records request does not change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT ((OLD.status = 'submitted' AND NEW.status IN ('submitted', 'in_review', 'fulfilled', 'declined', 'withdrawn'))
       OR (OLD.status = 'in_review' AND NEW.status IN ('in_review', 'fulfilled', 'declined', 'withdrawn'))) THEN
    RAISE EXCEPTION 'records request status % cannot become %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER records_request_history BEFORE UPDATE OR DELETE ON records_request
  FOR EACH ROW EXECUTE FUNCTION records_request_guard();

-- Documents of the patient shared in answer to a request (the patient downloads them in MyHealth).
CREATE TABLE records_request_document (
  organization_id  uuid        NOT NULL,
  request_id       uuid        NOT NULL,
  patient_id       uuid        NOT NULL,
  document_id      uuid        NOT NULL,
  shared_at        timestamptz NOT NULL DEFAULT now(),
  shared_by        uuid        NOT NULL REFERENCES app_user (id),
  PRIMARY KEY (request_id, document_id),
  FOREIGN KEY (organization_id, request_id) REFERENCES records_request (organization_id, id),
  FOREIGN KEY (patient_id, request_id)      REFERENCES records_request (patient_id, id),
  FOREIGN KEY (organization_id, document_id) REFERENCES document (organization_id, id)
);

CREATE INDEX records_request_document_patient ON records_request_document (patient_id, shared_at DESC);

CREATE TRIGGER records_request_document_append_only BEFORE UPDATE OR DELETE ON records_request_document
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- permissions ---------------------------------------------------------------------------------------------

INSERT INTO permission (key, description)
VALUES ('patient.records-request.manage', 'Review patients'' records requests: share documents or decline with a reason');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'patient.records-request.manage' FROM role r
WHERE r.key IN ('org_admin', 'records_officer') AND r.is_system
ON CONFLICT DO NOTHING;
