-- Reagent lots on laboratory results and QC runs (Phase 9). See docs/domains/laboratory-quality.md.
--
-- The laboratory records which inventory reagent lot is loaded on an instrument (for all its tests, or one test).
-- A result entered, or a QC run recorded, on the instrument records the lots in use at that moment. Loading a new lot
-- of the same reagent replaces the previous one; the load history is kept. The lot itself belongs to inventory
-- (libs/inventory); the load keeps a snapshot of what identified it (item, lot number, expiry) for the record.

CREATE TABLE lab_reagent_load (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES organization (id),
  facility_id        uuid        NOT NULL,
  instrument_id      uuid        NOT NULL,
  -- null: the lot serves every test on the instrument.
  test_id            uuid,
  inventory_item_id  uuid        NOT NULL,
  inventory_lot_id   uuid        NOT NULL,
  item_code          text        NOT NULL,
  item_name          text        NOT NULL,
  lot_number         text,
  expiry_date        date,
  loaded_at          timestamptz NOT NULL,
  loaded_by          uuid        NOT NULL REFERENCES app_user (id),
  unloaded_at        timestamptz,
  unloaded_by        uuid        REFERENCES app_user (id),
  unload_reason      text        CHECK (length(unload_reason) <= 500),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id)       REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, instrument_id)     REFERENCES lab_instrument (organization_id, id),
  FOREIGN KEY (organization_id, test_id)           REFERENCES lab_test (organization_id, id),
  FOREIGN KEY (organization_id, inventory_item_id) REFERENCES inventory_item (organization_id, id),
  FOREIGN KEY (organization_id, inventory_lot_id)  REFERENCES inventory_lot (organization_id, id),
  CHECK ((unloaded_at IS NULL) = (unloaded_by IS NULL)),
  CHECK (unloaded_at IS NULL OR (unloaded_at >= loaded_at AND length(btrim(unload_reason)) > 0))
);
-- One lot of a reagent in use per instrument and test scope.
CREATE UNIQUE INDEX lab_reagent_load_current ON lab_reagent_load (instrument_id, coalesce(test_id, '00000000-0000-0000-0000-000000000000'::uuid), inventory_item_id)
  WHERE unloaded_at IS NULL;
CREATE INDEX lab_reagent_load_instrument_idx ON lab_reagent_load (instrument_id, loaded_at DESC);

-- A load is history: only unloading (once) changes it, and nothing is deleted.
CREATE FUNCTION lab_reagent_load_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'reagent loads are not deleted' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF OLD.unloaded_at IS NOT NULL
     OR (NEW.organization_id, NEW.facility_id, NEW.instrument_id, NEW.test_id, NEW.inventory_item_id, NEW.inventory_lot_id, NEW.item_code,
         NEW.item_name, NEW.lot_number, NEW.expiry_date, NEW.loaded_at, NEW.loaded_by)
        IS DISTINCT FROM
        (OLD.organization_id, OLD.facility_id, OLD.instrument_id, OLD.test_id, OLD.inventory_item_id, OLD.inventory_lot_id, OLD.item_code,
         OLD.item_name, OLD.lot_number, OLD.expiry_date, OLD.loaded_at, OLD.loaded_by) THEN
    RAISE EXCEPTION 'a reagent load only changes when it is unloaded, once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_reagent_load_history BEFORE UPDATE OR DELETE ON lab_reagent_load
  FOR EACH ROW EXECUTE FUNCTION lab_reagent_load_guard();

-- The lots in use when a result was entered / a QC run was recorded. Append-only.
CREATE TABLE lab_result_reagent (
  organization_id  uuid NOT NULL,
  result_id        uuid NOT NULL,
  reagent_load_id  uuid NOT NULL,
  PRIMARY KEY (result_id, reagent_load_id),
  FOREIGN KEY (organization_id, result_id)       REFERENCES lab_result (organization_id, id),
  FOREIGN KEY (organization_id, reagent_load_id) REFERENCES lab_reagent_load (organization_id, id)
);
CREATE INDEX lab_result_reagent_load_idx ON lab_result_reagent (reagent_load_id);
CREATE TRIGGER lab_result_reagent_append_only BEFORE UPDATE OR DELETE ON lab_result_reagent
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TABLE lab_qc_run_reagent (
  organization_id  uuid NOT NULL,
  qc_run_id        uuid NOT NULL,
  reagent_load_id  uuid NOT NULL,
  PRIMARY KEY (qc_run_id, reagent_load_id),
  FOREIGN KEY (organization_id, qc_run_id)       REFERENCES lab_qc_run (organization_id, id),
  FOREIGN KEY (organization_id, reagent_load_id) REFERENCES lab_reagent_load (organization_id, id)
);
CREATE TRIGGER lab_qc_run_reagent_append_only BEFORE UPDATE OR DELETE ON lab_qc_run_reagent
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- When true, loading a new reagent lot for a test starts its QC window again: only runs after the change count.
ALTER TABLE lab_facility_policy ADD COLUMN qc_after_reagent_change boolean NOT NULL DEFAULT true;
