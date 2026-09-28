-- Send-out tests to external reference laboratories (Phase 8, external systems). See docs/domains/laboratory.md
-- (Send-out tests) and docs/interoperability/reference-laboratories.md.
--
-- The organization records the reference laboratories it uses (the accreditation / licence reference is recorded as
-- staff give it; nothing is verified) and, per facility, which catalog tests that facility's laboratory refers out.
-- A referred test follows the normal order → collection → receipt path, then gets a send-out record:
--   prepared → dispatched (handover: courier, manifest reference, time) → results_received (the reference laboratory's
--   own accession number) | rejected (by the reference laboratory, with its reason) | cancelled.
-- Results from the reference laboratory are entered as normal, versioned results, attributed to it, and go through
-- the usual verify / approve / release rules. No electronic interface (HL7 v2, ASTM, vendor API) is on record: an
-- electronic submission is an integration dependency (libs/interoperability, ReferenceLabGateway).

-- ---------------------------------------------------------------------------------------------
-- Configuration (organization; audited)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE lab_reference_laboratory (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL REFERENCES organization (id),
  code                     text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name                     text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  contact_name             text        CHECK (length(contact_name) <= 160),
  phone                    text        CHECK (length(phone) <= 40),
  email                    text        CHECK (length(email) <= 200),
  address                  text        CHECK (length(address) <= 500),
  -- The laboratory's accreditation / licence reference as recorded by staff (e.g. from its licence); not verified.
  accreditation_reference  text        CHECK (length(accreditation_reference) <= 120),
  notes                    text        CHECK (length(notes) <= 1000),
  status                   text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id)
);

-- Which tests a facility's laboratory refers out, and to which reference laboratory (the catalog is organization-wide;
-- what is performed where is per facility, like lab_facility_policy).
CREATE TABLE lab_test_referral (
  facility_id              uuid        NOT NULL,
  organization_id          uuid        NOT NULL,
  test_id                  uuid        NOT NULL,
  reference_laboratory_id  uuid        NOT NULL,
  -- Expected turnaround at the reference laboratory, counted from dispatch (defaults to the test's turnaround).
  turnaround_minutes       integer     CHECK (turnaround_minutes > 0),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid        NOT NULL REFERENCES app_user (id),
  version                  integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (facility_id, test_id),
  FOREIGN KEY (organization_id, facility_id)             REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, test_id)                 REFERENCES lab_test (organization_id, id),
  FOREIGN KEY (organization_id, reference_laboratory_id) REFERENCES lab_reference_laboratory (organization_id, id)
);

-- ---------------------------------------------------------------------------------------------
-- Dispatches (one handover to a reference laboratory: the manifest) and send-outs (one per referred test)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE lab_send_out_manifest_sequence (
  organization_id  uuid   PRIMARY KEY REFERENCES organization (id),
  next_value       bigint NOT NULL CHECK (next_value > 0)
);

CREATE TABLE lab_send_out_dispatch (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid        NOT NULL,
  facility_id                 uuid        NOT NULL,
  reference_laboratory_id     uuid        NOT NULL,
  manifest_number             text        NOT NULL CHECK (manifest_number ~ '^SM[0-9]{8,}$'),
  -- Who carries the specimens (courier company, the laboratory's own rider…) and their manifest / waybill reference.
  courier                     text        NOT NULL CHECK (length(btrim(courier)) BETWEEN 1 AND 120),
  courier_reference           text        CHECK (length(courier_reference) <= 80),
  dispatched_at               timestamptz NOT NULL,
  dispatched_by               uuid        NOT NULL REFERENCES app_user (id),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  -- Set once when an electronic submission is acknowledged by the reference laboratory (integration adapter).
  electronic_reference        text        CHECK (length(electronic_reference) <= 120),
  electronic_acknowledged_at  timestamptz,
  UNIQUE (organization_id, manifest_number),
  UNIQUE (organization_id, id),
  UNIQUE (id, facility_id, reference_laboratory_id),
  FOREIGN KEY (organization_id, facility_id)             REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, reference_laboratory_id) REFERENCES lab_reference_laboratory (organization_id, id),
  CHECK ((electronic_reference IS NULL) = (electronic_acknowledged_at IS NULL))
);
CREATE INDEX lab_send_out_dispatch_recent_idx ON lab_send_out_dispatch (facility_id, dispatched_at DESC);

-- A dispatch is a record of a handover: it never changes, except that an electronic acknowledgement is added once.
CREATE FUNCTION lab_send_out_dispatch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'send-out dispatches are not deleted' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF (NEW.organization_id, NEW.facility_id, NEW.reference_laboratory_id, NEW.manifest_number, NEW.courier, NEW.courier_reference,
      NEW.dispatched_at, NEW.dispatched_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.organization_id, OLD.facility_id, OLD.reference_laboratory_id, OLD.manifest_number, OLD.courier, OLD.courier_reference,
      OLD.dispatched_at, OLD.dispatched_by, OLD.created_at)
     OR (OLD.electronic_reference IS NOT NULL
         AND (NEW.electronic_reference, NEW.electronic_acknowledged_at) IS DISTINCT FROM (OLD.electronic_reference, OLD.electronic_acknowledged_at)) THEN
    RAISE EXCEPTION 'a send-out dispatch cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_send_out_dispatch_immutable BEFORE UPDATE OR DELETE ON lab_send_out_dispatch
  FOR EACH ROW EXECUTE FUNCTION lab_send_out_dispatch_guard();

CREATE TABLE lab_send_out (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL,
  facility_id              uuid        NOT NULL,
  patient_id               uuid        NOT NULL,
  order_id                 uuid        NOT NULL,
  order_item_id            uuid        NOT NULL,
  specimen_id              uuid        NOT NULL,
  reference_laboratory_id  uuid        NOT NULL,
  status                   text        NOT NULL DEFAULT 'prepared'
                             CHECK (status IN ('prepared', 'dispatched', 'results_received', 'rejected', 'cancelled')),
  -- Expected turnaround (minutes from dispatch), snapshotted when prepared.
  turnaround_minutes       integer     CHECK (turnaround_minutes > 0),
  prepared_at              timestamptz NOT NULL DEFAULT now(),
  prepared_by              uuid        NOT NULL REFERENCES app_user (id),
  dispatch_id              uuid,
  dispatched_at            timestamptz,
  -- The reference laboratory's own accession number for the specimen (recorded when results come back or it rejects).
  reference_accession      text        CHECK (length(btrim(reference_accession)) BETWEEN 1 AND 60),
  results_received_at      timestamptz,
  results_received_by      uuid        REFERENCES app_user (id),
  rejected_at              timestamptz,
  rejected_by              uuid        REFERENCES app_user (id),
  rejection_reason         text,
  cancelled_at             timestamptz,
  cancelled_by             uuid        REFERENCES app_user (id),
  cancellation_reason      text,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (patient_id, id),
  FOREIGN KEY (organization_id, facility_id)                      REFERENCES facility (organization_id, id),
  FOREIGN KEY (patient_id, order_id)                              REFERENCES lab_order (patient_id, id),
  FOREIGN KEY (patient_id, order_item_id)                         REFERENCES lab_order_item (patient_id, id),
  FOREIGN KEY (patient_id, specimen_id)                           REFERENCES lab_specimen (patient_id, id),
  FOREIGN KEY (organization_id, reference_laboratory_id)          REFERENCES lab_reference_laboratory (organization_id, id),
  -- A send-out travels in a dispatch of the same facility to the same reference laboratory.
  FOREIGN KEY (dispatch_id, facility_id, reference_laboratory_id) REFERENCES lab_send_out_dispatch (id, facility_id, reference_laboratory_id),
  CHECK ((dispatch_id IS NULL) = (dispatched_at IS NULL)),
  CHECK (status NOT IN ('dispatched', 'results_received', 'rejected') OR dispatch_id IS NOT NULL),
  CHECK (status <> 'prepared' OR dispatch_id IS NULL),
  CHECK ((status = 'results_received') = (results_received_at IS NOT NULL)),
  CHECK ((results_received_at IS NULL) = (results_received_by IS NULL)),
  CHECK (results_received_at IS NULL OR reference_accession IS NOT NULL),
  CHECK ((status = 'rejected') = (rejected_at IS NOT NULL)),
  CHECK ((rejected_at IS NULL) = (rejected_by IS NULL)),
  CHECK (rejected_at IS NULL OR length(btrim(rejection_reason)) > 0),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK ((cancelled_at IS NULL) = (cancelled_by IS NULL)),
  CHECK (cancelled_at IS NULL OR length(btrim(cancellation_reason)) > 0)
);
-- At most one send-out in flight per ordered test (after an answer, a rejection or a cancellation — or a recollected
-- specimen — the test can be sent out again).
CREATE UNIQUE INDEX lab_send_out_in_flight_idx ON lab_send_out (order_item_id) WHERE status IN ('prepared', 'dispatched');
CREATE INDEX lab_send_out_facility_idx ON lab_send_out (facility_id, status, prepared_at);
CREATE INDEX lab_send_out_dispatch_idx ON lab_send_out (dispatch_id) WHERE dispatch_id IS NOT NULL;

-- History is kept: only the status moves forward, and what was recorded at each step does not change.
CREATE FUNCTION lab_send_out_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'send-outs are not deleted; cancel them instead' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF (NEW.organization_id, NEW.facility_id, NEW.patient_id, NEW.order_id, NEW.order_item_id, NEW.specimen_id, NEW.reference_laboratory_id,
      NEW.turnaround_minutes, NEW.prepared_at, NEW.prepared_by)
     IS DISTINCT FROM
     (OLD.organization_id, OLD.facility_id, OLD.patient_id, OLD.order_id, OLD.order_item_id, OLD.specimen_id, OLD.reference_laboratory_id,
      OLD.turnaround_minutes, OLD.prepared_at, OLD.prepared_by) THEN
    RAISE EXCEPTION 'a send-out''s test, specimen and reference laboratory cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'prepared'   AND NEW.status IN ('dispatched', 'cancelled')) OR
       (OLD.status = 'dispatched' AND NEW.status IN ('results_received', 'rejected', 'cancelled'))
     ) THEN
    RAISE EXCEPTION 'a send-out cannot move from % to %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('results_received', 'rejected', 'cancelled') THEN
    RAISE EXCEPTION 'the send-out is % and can no longer change', OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (OLD.dispatch_id IS NOT NULL AND (NEW.dispatch_id, NEW.dispatched_at) IS DISTINCT FROM (OLD.dispatch_id, OLD.dispatched_at)) THEN
    RAISE EXCEPTION 'a dispatched send-out stays in its dispatch' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_send_out_history BEFORE UPDATE OR DELETE ON lab_send_out
  FOR EACH ROW EXECUTE FUNCTION lab_send_out_guard();

-- ---------------------------------------------------------------------------------------------
-- Results performed by a reference laboratory
-- ---------------------------------------------------------------------------------------------

-- The performing laboratory of a result version: NULL = the ordering facility's own laboratory. The name is a snapshot
-- (what the report says even if the reference laboratory is renamed later).
ALTER TABLE lab_result ADD COLUMN send_out_id uuid;
ALTER TABLE lab_result ADD COLUMN reference_laboratory_id uuid;
ALTER TABLE lab_result ADD COLUMN performing_laboratory text;
ALTER TABLE lab_result ADD FOREIGN KEY (patient_id, send_out_id) REFERENCES lab_send_out (patient_id, id);
ALTER TABLE lab_result ADD FOREIGN KEY (organization_id, reference_laboratory_id) REFERENCES lab_reference_laboratory (organization_id, id);
ALTER TABLE lab_result ADD CHECK ((reference_laboratory_id IS NULL) = (performing_laboratory IS NULL));
ALTER TABLE lab_result ADD CHECK (performing_laboratory IS NULL OR length(btrim(performing_laboratory)) > 0);
ALTER TABLE lab_result ADD CHECK (send_out_id IS NULL OR reference_laboratory_id IS NOT NULL);

-- The attribution is part of the result's immutable values (same rules as 0015, with the new columns).
CREATE OR REPLACE FUNCTION lab_result_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'laboratory results cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.organization_id, NEW.facility_id, NEW.patient_id, NEW.order_id, NEW.order_item_id, NEW.test_id, NEW.version_number,
      NEW.supersedes_result_id, NEW.correction_reason, NEW.result_type, NEW.value_numeric, NEW.value_text, NEW.value_coded,
      NEW.unit, NEW.flag, NEW.critical, NEW.reference_range_id, NEW.ref_low, NEW.ref_high, NEW.ref_critical_low,
      NEW.ref_critical_high, NEW.ref_text, NEW.comment, NEW.method, NEW.instrument, NEW.patient_releasable,
      NEW.entered_at, NEW.entered_by, NEW.send_out_id, NEW.reference_laboratory_id, NEW.performing_laboratory)
     IS DISTINCT FROM
     (OLD.organization_id, OLD.facility_id, OLD.patient_id, OLD.order_id, OLD.order_item_id, OLD.test_id, OLD.version_number,
      OLD.supersedes_result_id, OLD.correction_reason, OLD.result_type, OLD.value_numeric, OLD.value_text, OLD.value_coded,
      OLD.unit, OLD.flag, OLD.critical, OLD.reference_range_id, OLD.ref_low, OLD.ref_high, OLD.ref_critical_low,
      OLD.ref_critical_high, OLD.ref_text, OLD.comment, OLD.method, OLD.instrument, OLD.patient_releasable,
      OLD.entered_at, OLD.entered_by, OLD.send_out_id, OLD.reference_laboratory_id, OLD.performing_laboratory) THEN
    RAISE EXCEPTION 'laboratory result values are immutable; enter a corrected version instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'entered'  AND NEW.status IN ('verified', 'superseded', 'cancelled')) OR
       (OLD.status = 'verified' AND NEW.status IN ('approved', 'superseded', 'cancelled')) OR
       (OLD.status = 'approved' AND NEW.status IN ('released', 'superseded', 'cancelled')) OR
       (OLD.status = 'released' AND NEW.status = 'superseded')
     ) THEN
    RAISE EXCEPTION 'laboratory result cannot move from % to %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('superseded', 'cancelled') THEN
    RAISE EXCEPTION 'laboratory result is % and can no longer change', OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Sign-offs, once recorded, are never rewritten.
  IF (OLD.verified_at IS NOT NULL AND (NEW.verified_at, NEW.verified_by, NEW.self_verified) IS DISTINCT FROM (OLD.verified_at, OLD.verified_by, OLD.self_verified))
     OR (OLD.approved_at IS NOT NULL AND (NEW.approved_at, NEW.approved_by, NEW.self_approved) IS DISTINCT FROM (OLD.approved_at, OLD.approved_by, OLD.self_approved))
     OR (OLD.released_at IS NOT NULL AND (NEW.released_at, NEW.released_by) IS DISTINCT FROM (OLD.released_at, OLD.released_by)) THEN
    RAISE EXCEPTION 'laboratory result sign-offs cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
