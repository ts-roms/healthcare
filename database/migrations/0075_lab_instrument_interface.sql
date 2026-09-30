-- Analyzer interfaces (HL7 v2 / ASTM): results an analyzer sends arrive for review, never straight into the record.
-- See docs/domains/laboratory-instruments.md.
--
-- An on-site gateway (or any integration account holding lab.instrument.message.submit) posts each message an
-- instrument sends. The message is kept as received (append-only); each result in it is matched to a specimen (by the
-- accession number in the instrument's configured field) and to an ordered test (through the instrument's analyzer-code
-- mapping). Laboratory staff then accept a result — it is entered through the ordinary result workflow (entry,
-- verification, approval, release), attributed to the instrument — or dismiss it with a reason. Analyzer flags and
-- result status codes are kept as sent and never interpreted.

CREATE TABLE lab_instrument_interface (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL,
  instrument_id       uuid        NOT NULL,
  protocol            text        NOT NULL CHECK (protocol IN ('hl7v2', 'astm')),
  specimen_id_field   text        NOT NULL,
  enabled             boolean     NOT NULL DEFAULT true,
  updated_by          uuid        NOT NULL REFERENCES app_user (id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (instrument_id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, instrument_id) REFERENCES lab_instrument (organization_id, id),
  CHECK ((protocol = 'hl7v2' AND specimen_id_field IN ('OBR-2', 'OBR-3', 'SPM-2'))
      OR (protocol = 'astm' AND specimen_id_field IN ('O-3', 'O-4')))
);

-- The analyzer's test code for each test it runs (per instrument; configuration, changed freely).
CREATE TABLE lab_instrument_test_code (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  instrument_id    uuid        NOT NULL,
  analyzer_code    text        NOT NULL CHECK (length(btrim(analyzer_code)) BETWEEN 1 AND 60),
  test_id          uuid        NOT NULL,
  updated_by       uuid        NOT NULL REFERENCES app_user (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instrument_id, analyzer_code),
  FOREIGN KEY (organization_id, instrument_id) REFERENCES lab_instrument (organization_id, id),
  FOREIGN KEY (organization_id, test_id)       REFERENCES lab_test (organization_id, id)
);

-- Every message received, as received. Repeated deliveries (same instrument and control id) are recognised.
CREATE TABLE lab_instrument_message (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  facility_id      uuid        NOT NULL,
  instrument_id    uuid        NOT NULL,
  protocol         text        NOT NULL CHECK (protocol IN ('hl7v2', 'astm')),
  control_id       text        CHECK (length(control_id) BETWEEN 1 AND 200),
  content          text        NOT NULL CHECK (length(content) BETWEEN 1 AND 1048576),
  outcome          text        NOT NULL CHECK (outcome IN ('read', 'rejected')),
  error_code       text,
  result_count     integer     NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  received_at      timestamptz NOT NULL DEFAULT now(),
  received_by      uuid        NOT NULL REFERENCES app_user (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id)   REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, instrument_id) REFERENCES lab_instrument (organization_id, id),
  CHECK ((outcome = 'rejected') = (error_code IS NOT NULL))
);
CREATE UNIQUE INDEX lab_instrument_message_control ON lab_instrument_message (instrument_id, control_id) WHERE control_id IS NOT NULL AND outcome = 'read';
CREATE INDEX lab_instrument_message_recent ON lab_instrument_message (instrument_id, received_at DESC);

CREATE FUNCTION lab_instrument_message_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'instrument messages are kept as received' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER lab_instrument_message_append_only BEFORE UPDATE OR DELETE ON lab_instrument_message
  FOR EACH ROW EXECUTE FUNCTION lab_instrument_message_guard();

-- Each result of a message, awaiting review. Matched results name the specimen, the ordered test and the patient.
CREATE TABLE lab_instrument_result (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  facility_id       uuid        NOT NULL,
  instrument_id     uuid        NOT NULL,
  message_id        uuid        NOT NULL,
  sequence          integer     NOT NULL CHECK (sequence > 0),
  specimen_code     text,
  analyzer_code     text,
  value_raw         text        NOT NULL CHECK (length(value_raw) <= 4000),
  units_raw         text,
  reference_raw     text,
  flags_raw         text,
  status_raw        text,
  observed_raw      text,
  patient_id        uuid,
  specimen_id       uuid,
  order_item_id     uuid,
  test_id           uuid,
  -- Why it could not be matched (null when matched).
  match_problem     text        CHECK (match_problem IN ('no_specimen_id', 'unknown_specimen', 'no_test_code', 'unmapped_code', 'test_not_ordered')),
  state             text        NOT NULL CHECK (state IN ('pending', 'accepted', 'dismissed')),
  result_id         uuid        REFERENCES lab_result (id),
  decided_by        uuid        REFERENCES app_user (id),
  decided_at        timestamptz,
  dismiss_reason    text        CHECK (length(btrim(dismiss_reason)) BETWEEN 3 AND 500),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, sequence),
  FOREIGN KEY (organization_id, message_id)    REFERENCES lab_instrument_message (organization_id, id),
  FOREIGN KEY (organization_id, instrument_id) REFERENCES lab_instrument (organization_id, id),
  FOREIGN KEY (patient_id, specimen_id)        REFERENCES lab_specimen (patient_id, id),
  FOREIGN KEY (patient_id, order_item_id)      REFERENCES lab_order_item (patient_id, id),
  FOREIGN KEY (organization_id, test_id)       REFERENCES lab_test (organization_id, id),
  CHECK ((match_problem IS NULL) = (order_item_id IS NOT NULL AND specimen_id IS NOT NULL AND patient_id IS NOT NULL AND test_id IS NOT NULL)),
  CHECK ((state = 'accepted') = (result_id IS NOT NULL)),
  CHECK (state <> 'accepted' OR match_problem IS NULL),
  CHECK ((state = 'pending') = (decided_at IS NULL)),
  CHECK ((decided_at IS NULL) = (decided_by IS NULL)),
  CHECK ((state = 'dismissed') = (dismiss_reason IS NOT NULL))
);
CREATE INDEX lab_instrument_result_pending ON lab_instrument_result (facility_id, created_at) WHERE state = 'pending';
CREATE INDEX lab_instrument_result_item ON lab_instrument_result (order_item_id) WHERE order_item_id IS NOT NULL;

-- A decided result never changes; none is deleted.
CREATE FUNCTION lab_instrument_result_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'instrument results are not deleted' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF OLD.state <> 'pending'
     OR (NEW.id, NEW.organization_id, NEW.facility_id, NEW.instrument_id, NEW.message_id, NEW.sequence, NEW.specimen_code, NEW.analyzer_code,
         NEW.value_raw, NEW.units_raw, NEW.reference_raw, NEW.flags_raw, NEW.status_raw, NEW.observed_raw, NEW.created_at)
        IS DISTINCT FROM
        (OLD.id, OLD.organization_id, OLD.facility_id, OLD.instrument_id, OLD.message_id, OLD.sequence, OLD.specimen_code, OLD.analyzer_code,
         OLD.value_raw, OLD.units_raw, OLD.reference_raw, OLD.flags_raw, OLD.status_raw, OLD.observed_raw, OLD.created_at) THEN
    RAISE EXCEPTION 'an instrument result is decided once; what the instrument sent never changes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_instrument_result_history BEFORE UPDATE OR DELETE ON lab_instrument_result
  FOR EACH ROW EXECUTE FUNCTION lab_instrument_result_guard();

INSERT INTO permission (key, description) VALUES
  ('lab.instrument.message.submit', 'Submit analyzer result messages (HL7 v2 / ASTM) for review — for the instrument gateway''s integration account');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'lab.instrument.message.submit' FROM role r
WHERE r.key = 'org_admin' AND r.is_system
ON CONFLICT DO NOTHING;
