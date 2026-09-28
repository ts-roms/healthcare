-- Reagent stock used when a lot is loaded (Phase 9). See docs/domains/laboratory-quality.md.
--
-- Loading a reagent lot on an instrument can take that lot's stock from a storage location of the facility in the same
-- transaction (an inventory issue whose source is the load). The load records the stock movement group; loads without
-- a stock movement (stock issued to the laboratory separately) stay possible.

ALTER TABLE lab_reagent_load
  ADD COLUMN stock_location_id       uuid,
  ADD COLUMN stock_quantity          integer CHECK (stock_quantity > 0),
  ADD COLUMN stock_movement_group_id uuid,
  ADD CONSTRAINT lab_reagent_load_stock_location FOREIGN KEY (organization_id, stock_location_id) REFERENCES inventory_location (organization_id, id),
  ADD CONSTRAINT lab_reagent_load_stock_all_or_none
    CHECK ((stock_location_id IS NULL) = (stock_quantity IS NULL) AND (stock_quantity IS NULL) = (stock_movement_group_id IS NULL));

CREATE OR REPLACE FUNCTION lab_reagent_load_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'reagent loads are not deleted' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF OLD.unloaded_at IS NOT NULL
     OR (NEW.organization_id, NEW.facility_id, NEW.instrument_id, NEW.test_id, NEW.inventory_item_id, NEW.inventory_lot_id, NEW.item_code,
         NEW.item_name, NEW.lot_number, NEW.expiry_date, NEW.loaded_at, NEW.loaded_by, NEW.stock_location_id, NEW.stock_quantity,
         NEW.stock_movement_group_id)
        IS DISTINCT FROM
        (OLD.organization_id, OLD.facility_id, OLD.instrument_id, OLD.test_id, OLD.inventory_item_id, OLD.inventory_lot_id, OLD.item_code,
         OLD.item_name, OLD.lot_number, OLD.expiry_date, OLD.loaded_at, OLD.loaded_by, OLD.stock_location_id, OLD.stock_quantity,
         OLD.stock_movement_group_id) THEN
    RAISE EXCEPTION 'a reagent load only changes when it is unloaded, once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
