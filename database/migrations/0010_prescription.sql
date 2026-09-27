-- Prescriptions (Phase 2). Issued prescriptions are immutable; changes are cancel/replace.
CREATE TABLE prescription_number_sequence (
  organization_id  uuid   PRIMARY KEY REFERENCES organization (id),
  next_value       bigint NOT NULL CHECK (next_value > 0)
);

CREATE TABLE prescription (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid        NOT NULL,
  facility_id                 uuid        NOT NULL,
  patient_id                  uuid        NOT NULL,
  encounter_id                uuid        NOT NULL,
  prescriber_practitioner_id  uuid        NOT NULL,
  prescription_number         text        NOT NULL,
  status                      text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'superseded')),
  issued_at                   timestamptz NOT NULL DEFAULT now(),
  issued_by                   uuid        NOT NULL REFERENCES app_user (id),
  notes                       text,
  replaces_prescription_id    uuid        REFERENCES prescription (id),
  -- Documented override of drug–allergy decision-support warnings, if any were shown.
  allergy_override_reason     text,
  allergy_warnings            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  cancelled_at                timestamptz,
  cancelled_by                uuid        REFERENCES app_user (id),
  cancellation_reason         text,
  UNIQUE (organization_id, prescription_number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id)                REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)                 REFERENCES patient (organization_id, id),
  FOREIGN KEY (patient_id, encounter_id)                    REFERENCES encounter (patient_id, id),
  FOREIGN KEY (organization_id, prescriber_practitioner_id) REFERENCES practitioner (organization_id, id),
  CHECK ((status = 'active') = (cancelled_at IS NULL)),
  CHECK (cancelled_at IS NULL OR length(btrim(cancellation_reason)) > 0),
  CHECK (jsonb_array_length(allergy_warnings) = 0 OR length(btrim(allergy_override_reason)) > 0)
);
CREATE INDEX prescription_patient_idx ON prescription (patient_id, issued_at DESC);

CREATE TABLE prescription_item (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id   uuid        NOT NULL REFERENCES prescription (id),
  line_number       smallint    NOT NULL CHECK (line_number > 0),
  -- Generic name is required; brand is optional.
  generic_name      text        NOT NULL CHECK (length(btrim(generic_name)) > 0),
  brand_name        text,
  strength          text,
  dosage_form       text,
  dose_amount       numeric(10,3) CHECK (dose_amount > 0),
  dose_unit         text,
  route             text        NOT NULL CHECK (route IN
                      ('oral', 'sublingual', 'buccal', 'topical', 'transdermal', 'inhalation', 'nasal', 'ophthalmic', 'otic',
                       'rectal', 'vaginal', 'subcutaneous', 'intramuscular', 'intravenous', 'other')),
  frequency         text        NOT NULL CHECK (frequency IN
                      ('once', 'once_daily', 'twice_daily', 'three_times_daily', 'four_times_daily', 'every_4_hours',
                       'every_6_hours', 'every_8_hours', 'every_12_hours', 'at_bedtime', 'weekly', 'as_needed', 'custom')),
  frequency_text    text,
  as_needed_reason  text,
  duration_value    integer     CHECK (duration_value > 0),
  duration_unit     text        CHECK (duration_unit IN ('days', 'weeks', 'months')),
  quantity          numeric(10,2) NOT NULL CHECK (quantity > 0),
  quantity_unit     text        NOT NULL CHECK (length(btrim(quantity_unit)) > 0),
  refills           smallint    NOT NULL DEFAULT 0 CHECK (refills BETWEEN 0 AND 11),
  instructions      text        NOT NULL CHECK (length(btrim(instructions)) > 0),
  UNIQUE (prescription_id, line_number),
  CHECK ((dose_amount IS NULL) = (dose_unit IS NULL)),
  CHECK ((duration_value IS NULL) = (duration_unit IS NULL)),
  CHECK (frequency <> 'custom' OR length(btrim(frequency_text)) > 0),
  CHECK (frequency <> 'as_needed' OR length(btrim(as_needed_reason)) > 0)
);
CREATE TRIGGER prescription_item_append_only BEFORE UPDATE OR DELETE ON prescription_item
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- Only the status may change after issue (active → cancelled | superseded), never back.
CREATE FUNCTION prescription_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'prescriptions cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'active' THEN
    RAISE EXCEPTION 'prescription % is % and can no longer change', OLD.prescription_number, OLD.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.organization_id, NEW.facility_id, NEW.patient_id, NEW.encounter_id, NEW.prescriber_practitioner_id,
      NEW.prescription_number, NEW.issued_at, NEW.issued_by, NEW.notes, NEW.replaces_prescription_id,
      NEW.allergy_override_reason, NEW.allergy_warnings)
     IS DISTINCT FROM
     (OLD.organization_id, OLD.facility_id, OLD.patient_id, OLD.encounter_id, OLD.prescriber_practitioner_id,
      OLD.prescription_number, OLD.issued_at, OLD.issued_by, OLD.notes, OLD.replaces_prescription_id,
      OLD.allergy_override_reason, OLD.allergy_warnings) THEN
    RAISE EXCEPTION 'issued prescriptions are immutable; cancel and replace instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prescription_immutable BEFORE UPDATE OR DELETE ON prescription
  FOR EACH ROW EXECUTE FUNCTION prescription_guard();
