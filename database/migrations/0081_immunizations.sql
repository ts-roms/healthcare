-- Immunization history (docs/domains/immunizations.md).
--
-- The organization keeps its own vaccine catalogue (names, products, optional codes of a code system it names, route
-- and site options, and the number of doses in a series as it records them). No national immunization schedule,
-- vaccine list, dose interval, catch-up rule, registry format or code set is encoded: official schedules, national
-- immunization registry reporting and official vaccine code sets are dependencies (docs/interoperability/dependencies.md).
--
-- A patient's immunization records are doses given here (from stock or not), doses reported by the patient or another
-- provider (historical), and doses accepted from a FHIR import (external_import). A record never changes except: it is
-- marked entered in error with a reason (never deleted; a dose taken from stock goes back to stock once, in the same
-- transaction), and an adverse reaction noticed afterwards may be added once.

-- ---- permissions --------------------------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('immunization.read',   'View a patient''s immunization history'),
  ('immunization.record', 'Record doses given, not given or reported, add a reaction, and mark a record entered in error');

-- The vaccine catalogue is clinic configuration (clinic.configure). Physicians and nurses record doses; dentists and
-- the records office read the history. Organizations grant more through their own roles.
INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('org_admin', 'immunization.read'), ('org_admin', 'immunization.record'),
  ('physician', 'immunization.read'), ('physician', 'immunization.record'),
  ('nurse', 'immunization.read'), ('nurse', 'immunization.record'),
  ('dentist', 'immunization.read'),
  ('records_officer', 'immunization.read')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system
ON CONFLICT DO NOTHING;

-- ---- the organization's vaccine catalogue -------------------------------------------------------------------

CREATE TABLE immunization_vaccine (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  name             text        NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 200),
  product_name     text        CHECK (length(btrim(product_name)) BETWEEN 1 AND 200),
  manufacturer     text        CHECK (length(btrim(manufacturer)) BETWEEN 1 AND 200),
  -- A code of a code system the organization names (a key, e.g. "vaccine" for its own list; exported under
  -- FHIR_CODE_SYSTEMS[key] when configured, else a local namespace). No official code set is assumed.
  code_system      text        CHECK (code_system ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  code             text        CHECK (length(btrim(code)) BETWEEN 1 AND 40),
  routes           text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(routes) <= 10),
  sites            text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(sites) <= 20),
  -- As the organization records it; informational only (nothing is scheduled or computed from it).
  doses_in_series  smallint    CHECK (doses_in_series BETWEEN 1 AND 20),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid        NOT NULL REFERENCES app_user (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  CHECK ((code IS NULL) = (code_system IS NULL))
);
CREATE UNIQUE INDEX immunization_vaccine_active_name ON immunization_vaccine
  (organization_id, lower(btrim(name)), lower(btrim(coalesce(product_name, '')))) WHERE status = 'active';
CREATE UNIQUE INDEX immunization_vaccine_active_code ON immunization_vaccine (organization_id, code_system, code)
  WHERE status = 'active' AND code IS NOT NULL;

-- ---- immunization records -----------------------------------------------------------------------------------

CREATE TABLE immunization (
  id                            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               uuid         NOT NULL,
  patient_id                    uuid         NOT NULL,
  -- administered_here: the facility where it was given (or not given); null otherwise.
  facility_id                   uuid,
  encounter_id                  uuid,
  vaccine_id                    uuid,
  -- The vaccine as recorded (a snapshot of the catalogue entry, or as reported / received).
  vaccine_name                  text         NOT NULL CHECK (length(btrim(vaccine_name)) BETWEEN 1 AND 200),
  vaccine_product               text         CHECK (length(btrim(vaccine_product)) BETWEEN 1 AND 200),
  vaccine_manufacturer          text         CHECK (length(btrim(vaccine_manufacturer)) BETWEEN 1 AND 200),
  -- A catalogue code-system key, or the system URI as received for an import.
  vaccine_code_system           text         CHECK (length(vaccine_code_system) BETWEEN 1 AND 200),
  vaccine_code                  text         CHECK (length(btrim(vaccine_code)) BETWEEN 1 AND 60),
  -- The dose as the clinician or source recorded it (e.g. "1", "booster"); nothing is derived from it.
  dose_label                    text         CHECK (length(btrim(dose_label)) BETWEEN 1 AND 60),
  dose_number                   smallint     CHECK (dose_number BETWEEN 1 AND 50),
  -- When it was given: a year (stored as 1 January), a month (stored as its first day), a day, or a day and time.
  occurrence_date               date         NOT NULL,
  occurrence_precision          text         NOT NULL CHECK (occurrence_precision IN ('year', 'month', 'day', 'time')),
  occurred_at                   timestamptz,
  status                        text         NOT NULL CHECK (status IN ('completed', 'not_done')),
  status_reason                 text         CHECK (status_reason IN ('refused', 'contraindicated', 'unavailable', 'other')),
  -- The clinician's own words.
  status_reason_text            text         CHECK (length(btrim(status_reason_text)) BETWEEN 1 AND 500),
  source                        text         NOT NULL CHECK (source IN ('administered_here', 'historical', 'external_import')),
  performer_practitioner_id     uuid,
  performer_name                text         CHECK (length(btrim(performer_name)) BETWEEN 1 AND 200),
  lot_number                    text         CHECK (length(btrim(lot_number)) BETWEEN 1 AND 60),
  expiry_date                   date,
  route                         text         CHECK (length(btrim(route)) BETWEEN 1 AND 60),
  site                          text         CHECK (length(btrim(site)) BETWEEN 1 AND 60),
  dose_quantity                 numeric(8,3) CHECK (dose_quantity > 0),
  dose_unit                     text         CHECK (length(btrim(dose_unit)) BETWEEN 1 AND 20),
  -- Taken from inventory in the recording transaction (inventory movement source 'immunization', once).
  stock_item_id                 uuid,
  stock_location_id             uuid,
  stock_quantity                integer      CHECK (stock_quantity BETWEEN 1 AND 100),
  stock_movement_group_id       uuid,
  stock_return_group_id         uuid,
  -- historical: where the information comes from (e.g. "vaccination card"); external_import: as received.
  source_description            text         CHECK (length(btrim(source_description)) BETWEEN 1 AND 300),
  document_id                   uuid,
  source_reference              text         CHECK (length(source_reference) BETWEEN 1 AND 300),
  declared_source               text         CHECK (length(declared_source) BETWEEN 1 AND 200),
  notes                         text         CHECK (length(btrim(notes)) BETWEEN 1 AND 2000),
  adverse_reaction              text         CHECK (length(btrim(adverse_reaction)) BETWEEN 1 AND 1000),
  adverse_reaction_recorded_by  uuid         REFERENCES app_user (id),
  adverse_reaction_recorded_at  timestamptz,
  entered_in_error_reason       text         CHECK (length(btrim(entered_in_error_reason)) BETWEEN 3 AND 500),
  entered_in_error_by           uuid         REFERENCES app_user (id),
  entered_in_error_at           timestamptz,
  recorded_by                   uuid         NOT NULL REFERENCES app_user (id),
  recorded_at                   timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)                REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, facility_id)               REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, encounter_id)              REFERENCES encounter (organization_id, id),
  FOREIGN KEY (organization_id, vaccine_id)                REFERENCES immunization_vaccine (organization_id, id),
  FOREIGN KEY (organization_id, performer_practitioner_id) REFERENCES practitioner (organization_id, id),
  FOREIGN KEY (organization_id, stock_item_id)             REFERENCES inventory_item (organization_id, id),
  FOREIGN KEY (organization_id, stock_location_id)         REFERENCES inventory_location (organization_id, id),
  FOREIGN KEY (organization_id, document_id)               REFERENCES document (organization_id, id),
  -- Partial dates: a year is kept as 1 January, a month as its first day; a time only with precision 'time'.
  CHECK ((occurred_at IS NOT NULL) = (occurrence_precision = 'time')),
  CHECK (occurrence_precision <> 'year' OR (extract(month FROM occurrence_date) = 1 AND extract(day FROM occurrence_date) = 1)),
  CHECK (occurrence_precision <> 'month' OR extract(day FROM occurrence_date) = 1),
  -- Not given: a reason (the clinician's text is required for "other"); nothing given, taken from stock or reacted to.
  CHECK ((status = 'not_done') = (status_reason IS NOT NULL)),
  CHECK (status_reason IS DISTINCT FROM 'other' OR status_reason_text IS NOT NULL),
  CHECK (status = 'completed' OR (lot_number IS NULL AND expiry_date IS NULL AND route IS NULL AND site IS NULL AND dose_quantity IS NULL
                                  AND stock_item_id IS NULL AND adverse_reaction IS NULL)),
  CHECK (status = 'completed' OR source <> 'historical'),
  -- Given here: at a facility, from the catalogue, on a known day, with its lot; the expiry is not before that day.
  CHECK (source <> 'administered_here' OR (facility_id IS NOT NULL AND vaccine_id IS NOT NULL AND occurrence_precision IN ('day', 'time'))),
  CHECK (source <> 'administered_here' OR status <> 'completed' OR lot_number IS NOT NULL),
  CHECK (source <> 'administered_here' OR expiry_date IS NULL OR expiry_date >= occurrence_date),
  CHECK (source = 'administered_here' OR (facility_id IS NULL AND encounter_id IS NULL AND stock_item_id IS NULL)),
  -- Reported: where the information comes from; an uploaded scan only for these.
  CHECK (source <> 'historical' OR source_description IS NOT NULL),
  CHECK (document_id IS NULL OR source = 'historical'),
  -- Imported: the import reference.
  CHECK ((source = 'external_import') = (source_reference IS NOT NULL)),
  CHECK ((dose_quantity IS NULL) = (dose_unit IS NULL)),
  CHECK ((stock_item_id IS NULL) = (stock_location_id IS NULL) AND (stock_item_id IS NULL) = (stock_quantity IS NULL)
         AND (stock_item_id IS NULL) = (stock_movement_group_id IS NULL)),
  CHECK (stock_return_group_id IS NULL OR (stock_movement_group_id IS NOT NULL AND entered_in_error_at IS NOT NULL)),
  CHECK ((adverse_reaction IS NULL) = (adverse_reaction_recorded_at IS NULL) AND (adverse_reaction_recorded_at IS NULL) = (adverse_reaction_recorded_by IS NULL)),
  CHECK ((entered_in_error_at IS NULL) = (entered_in_error_by IS NULL) AND (entered_in_error_at IS NULL) = (entered_in_error_reason IS NULL))
);
CREATE INDEX immunization_patient_idx ON immunization (organization_id, patient_id, occurrence_date DESC);
CREATE INDEX immunization_patient_recorded_idx ON immunization (organization_id, patient_id, recorded_at DESC);
CREATE INDEX immunization_encounter_idx ON immunization (encounter_id) WHERE encounter_id IS NOT NULL;

-- Immutable except: marking entered in error (once, with the stock return when stock was taken) and adding an
-- adverse reaction (once, while not in error). Never deleted.
CREATE FUNCTION immunization_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable constant text[] := ARRAY['adverse_reaction', 'adverse_reaction_recorded_by', 'adverse_reaction_recorded_at',
                                   'entered_in_error_reason', 'entered_in_error_by', 'entered_in_error_at', 'stock_return_group_id'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'immunization records are never deleted; mark them entered in error' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable)
     OR (OLD.entered_in_error_at IS NOT NULL AND (NEW.entered_in_error_at, NEW.entered_in_error_by, NEW.entered_in_error_reason)
                                                 IS DISTINCT FROM (OLD.entered_in_error_at, OLD.entered_in_error_by, OLD.entered_in_error_reason))
     OR (OLD.adverse_reaction IS NOT NULL AND (NEW.adverse_reaction, NEW.adverse_reaction_recorded_by, NEW.adverse_reaction_recorded_at)
                                               IS DISTINCT FROM (OLD.adverse_reaction, OLD.adverse_reaction_recorded_by, OLD.adverse_reaction_recorded_at))
     OR (OLD.entered_in_error_at IS NOT NULL AND NEW.adverse_reaction IS DISTINCT FROM OLD.adverse_reaction)
     OR (OLD.stock_return_group_id IS NOT NULL AND NEW.stock_return_group_id IS DISTINCT FROM OLD.stock_return_group_id) THEN
    RAISE EXCEPTION 'immunization: only marking entered in error or adding a reaction, once each, is permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immunization_guard BEFORE UPDATE OR DELETE ON immunization FOR EACH ROW EXECUTE FUNCTION immunization_guard();
CREATE TRIGGER immunization_no_truncate BEFORE TRUNCATE ON immunization FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();

-- No new care filed under a merged record (ADR-0009, migration 0068).
CREATE TRIGGER immunization_not_for_merged_patient BEFORE INSERT ON immunization
  FOR EACH ROW EXECUTE FUNCTION refuse_record_for_merged_patient();

-- ---- inventory: vaccines as a category, and immunizations as a stock source ------------------------------------

ALTER TABLE inventory_item DROP CONSTRAINT inventory_item_category_check;
ALTER TABLE inventory_item ADD CONSTRAINT inventory_item_category_check
  CHECK (category IN ('medicine', 'medical_supply', 'reagent', 'laboratory_consumable', 'dental_supply', 'ppe', 'vaccine', 'other'));

ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_source_type_check;
ALTER TABLE inventory_movement ADD CONSTRAINT inventory_movement_source_type_check
  CHECK (source_type IN ('prescription_dispense', 'lab_reagent_load', 'purchase_order_line', 'dental_procedure', 'immunization'));

-- ---- FHIR imports: an accepted Immunization becomes an immunization record -------------------------------------

ALTER TABLE fhir_import_entry DROP CONSTRAINT fhir_import_entry_kind_check;
ALTER TABLE fhir_import_entry ADD CONSTRAINT fhir_import_entry_kind_check
  CHECK (kind IN ('patient', 'allergy', 'condition', 'observation', 'medication', 'document', 'immunization', 'not_supported'));
ALTER TABLE fhir_import_entry DROP CONSTRAINT fhir_import_entry_result_type_check;
ALTER TABLE fhir_import_entry ADD CONSTRAINT fhir_import_entry_result_type_check
  CHECK (result_type IN ('allergy_intolerance', 'external_history_entry', 'immunization', 'patient'));

-- ---- copies of the record may include the immunization history -----------------------------------------------

ALTER TABLE records_request_export DROP CONSTRAINT records_request_export_sections_check;
ALTER TABLE records_request_export ADD CONSTRAINT records_request_export_sections_check CHECK (cardinality(sections) > 0 AND sections <@ ARRAY[
  'allergies', 'consultations', 'laboratory', 'prescriptions', 'care_plans', 'dental', 'certificates', 'documents', 'immunizations'
]::text[]);
