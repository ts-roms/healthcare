-- Reagent use per test run (Phase 9). See docs/domains/laboratory-quality.md ("Reagent use").
--
-- A reagent lot loaded on an instrument can state how many tests it holds (its capacity): the stock taken at the load
-- times the reagent's yield (tests per stock unit, configured by the laboratory), or a number given at the load. Every
-- test run with the lot is counted against the load, append-only:
--   * a patient run — recorded with the result: an order measured on the instrument; the tests of one order entered in
--     the same result version count once (a panel is one run), a correction entered on the instrument is a re-run;
--   * a QC run — recorded with the QC run;
--   * other use recorded by staff with a reason: repeats not entered as results, calibration, priming, waste.
-- Stock leaves inventory when the lot is loaded (migration 0054); runs never move stock. What is left of the capacity
-- when a load is unloaded is its unused part.

-- ---- yield per reagent -------------------------------------------------------------------------------------------

CREATE TABLE lab_reagent_yield (
  organization_id    uuid        NOT NULL REFERENCES organization (id),
  inventory_item_id  uuid        NOT NULL,
  -- Snapshot of the inventory item when the yield was last set, for display.
  item_code          text        NOT NULL,
  item_name          text        NOT NULL,
  stock_unit         text        NOT NULL,
  -- Tests one stock unit (a cassette, a kit, a bottle) holds, as the manufacturer or the laboratory states it.
  tests_per_unit     integer     NOT NULL CHECK (tests_per_unit BETWEEN 1 AND 1000000),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid        NOT NULL REFERENCES app_user (id),
  PRIMARY KEY (organization_id, inventory_item_id),
  FOREIGN KEY (organization_id, inventory_item_id) REFERENCES inventory_item (organization_id, id)
);

-- ---- capacity of a load ------------------------------------------------------------------------------------------

ALTER TABLE lab_reagent_load ADD COLUMN capacity_tests integer CHECK (capacity_tests BETWEEN 1 AND 100000000);

CREATE OR REPLACE FUNCTION lab_reagent_load_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'reagent loads are not deleted' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF OLD.unloaded_at IS NOT NULL
     OR (NEW.organization_id, NEW.facility_id, NEW.instrument_id, NEW.test_id, NEW.inventory_item_id, NEW.inventory_lot_id, NEW.item_code,
         NEW.item_name, NEW.lot_number, NEW.expiry_date, NEW.loaded_at, NEW.loaded_by, NEW.stock_location_id, NEW.stock_quantity,
         NEW.stock_movement_group_id, NEW.capacity_tests)
        IS DISTINCT FROM
        (OLD.organization_id, OLD.facility_id, OLD.instrument_id, OLD.test_id, OLD.inventory_item_id, OLD.inventory_lot_id, OLD.item_code,
         OLD.item_name, OLD.lot_number, OLD.expiry_date, OLD.loaded_at, OLD.loaded_by, OLD.stock_location_id, OLD.stock_quantity,
         OLD.stock_movement_group_id, OLD.capacity_tests) THEN
    RAISE EXCEPTION 'a reagent load only changes when it is unloaded, once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- ---- use per run -------------------------------------------------------------------------------------------------

CREATE TABLE lab_reagent_use (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES organization (id),
  facility_id       uuid        NOT NULL,
  reagent_load_id   uuid        NOT NULL,
  kind              text        NOT NULL CHECK (kind IN ('patient', 'qc', 'repeat', 'calibration', 'priming', 'waste', 'other')),
  tests             integer     NOT NULL CHECK (tests BETWEEN 1 AND 100000),
  -- patient: the order and the result version that recorded the run.
  order_id          uuid,
  result_id         uuid,
  run_number        integer     CHECK (run_number > 0),
  -- qc: the QC run.
  qc_run_id         uuid,
  reason            text        CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  recorded_by       uuid        NOT NULL REFERENCES app_user (id),
  FOREIGN KEY (organization_id, facility_id)     REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, reagent_load_id) REFERENCES lab_reagent_load (organization_id, id),
  FOREIGN KEY (organization_id, order_id)        REFERENCES lab_order (organization_id, id),
  FOREIGN KEY (organization_id, result_id)       REFERENCES lab_result (organization_id, id),
  FOREIGN KEY (organization_id, qc_run_id)       REFERENCES lab_qc_run (organization_id, id),
  CHECK ((kind = 'patient') = (order_id IS NOT NULL) AND (order_id IS NULL) = (result_id IS NULL) AND (order_id IS NULL) = (run_number IS NULL)),
  CHECK ((kind = 'qc') = (qc_run_id IS NOT NULL)),
  CHECK (kind IN ('patient', 'qc') OR reason IS NOT NULL),
  CHECK (kind NOT IN ('patient', 'qc') OR tests = 1)
);

-- A panel entered for one order counts once per load and result version; a QC run once per load.
CREATE UNIQUE INDEX lab_reagent_use_patient_run ON lab_reagent_use (reagent_load_id, order_id, run_number) WHERE kind = 'patient';
CREATE UNIQUE INDEX lab_reagent_use_qc_run ON lab_reagent_use (reagent_load_id, qc_run_id) WHERE kind = 'qc';
CREATE INDEX lab_reagent_use_load ON lab_reagent_use (reagent_load_id, kind);
CREATE INDEX lab_reagent_use_recorded ON lab_reagent_use (organization_id, facility_id, recorded_at);

CREATE TRIGGER lab_reagent_use_append_only BEFORE UPDATE OR DELETE ON lab_reagent_use
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- runs already recorded ---------------------------------------------------------------------------------------

INSERT INTO lab_reagent_use (organization_id, facility_id, reagent_load_id, kind, tests, order_id, result_id, run_number, recorded_at, recorded_by)
SELECT DISTINCT ON (rr.reagent_load_id, r.order_id, r.version_number)
       r.organization_id, l.facility_id, rr.reagent_load_id, 'patient', 1, r.order_id, r.id, r.version_number, r.entered_at, r.entered_by
FROM lab_result_reagent rr
JOIN lab_result r ON r.id = rr.result_id
JOIN lab_reagent_load l ON l.id = rr.reagent_load_id
ORDER BY rr.reagent_load_id, r.order_id, r.version_number, r.entered_at;

INSERT INTO lab_reagent_use (organization_id, facility_id, reagent_load_id, kind, tests, qc_run_id, recorded_at, recorded_by)
SELECT q.organization_id, l.facility_id, qr.reagent_load_id, 'qc', 1, q.id, q.entered_at, q.entered_by
FROM lab_qc_run_reagent qr
JOIN lab_qc_run q ON q.id = qr.qc_run_id
JOIN lab_reagent_load l ON l.id = qr.reagent_load_id;
