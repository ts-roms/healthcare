-- Supplies used in procedures performed at the clinic, taken from inventory: the dental pattern (0057) for clinic
-- procedures. See docs/domains/clinic.md ("Procedures") and docs/domains/inventory.md.
--
-- The organization lists, per catalogue entry, the supplies usually used (a template). After a procedure, staff
-- confirm what was actually used and from which stock location; the issue is posted through the inventory library's
-- own command (first expiry first out, never expired lots, balances never negative, controlled items need a reason and
-- a reference) in the same transaction as the clinic's record of it. Unused supplies can be returned to the lots they
-- came from, with a reason. Like dental procedures, a clinic procedure may take from the same lot again and return
-- part of it several times, so it is left out of the once-per-lot index.

-- ---- inventory: clinic procedures as a movement source ---------------------------------------------------------

ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_source_type_check;
ALTER TABLE inventory_movement ADD CONSTRAINT inventory_movement_source_type_check
  CHECK (source_type IN ('prescription_dispense', 'lab_reagent_load', 'purchase_order_line', 'dental_procedure', 'immunization', 'clinic_procedure'));

DROP INDEX inventory_movement_source_once;
CREATE UNIQUE INDEX inventory_movement_source_once ON inventory_movement (organization_id, source_type, source_id, lot_id, kind)
  WHERE source_type IS NOT NULL AND source_type NOT IN ('dental_procedure', 'clinic_procedure') AND kind IN ('issue', 'return');

-- ---- clinic: supply templates (configuration) ------------------------------------------------------------------

-- The supplies a catalogue entry usually uses. Configuration only: staff confirm (and change) what was used each time.
CREATE TABLE clinic_procedure_supply_template_item (
  organization_id    uuid        NOT NULL,
  definition_id      uuid        NOT NULL,
  inventory_item_id  uuid        NOT NULL,
  quantity           integer     NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  position           smallint    NOT NULL CHECK (position BETWEEN 0 AND 99),
  updated_by         uuid        NOT NULL REFERENCES app_user (id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (definition_id, inventory_item_id),
  FOREIGN KEY (organization_id, definition_id)     REFERENCES clinic_procedure_definition (organization_id, id),
  FOREIGN KEY (organization_id, inventory_item_id) REFERENCES inventory_item (organization_id, id)
);

-- ---- clinic: supplies used by a procedure ----------------------------------------------------------------------

-- One confirmation of supplies used (kind `issue`) or a return of unused ones (kind `return`, with a reason), each one
-- inventory movement group posted in the same transaction. Append-only.
CREATE TABLE clinic_procedure_supply_use (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL,
  facility_id         uuid        NOT NULL,
  patient_id          uuid        NOT NULL,
  procedure_id        uuid        NOT NULL,
  kind                text        NOT NULL CHECK (kind IN ('issue', 'return')),
  location_id         uuid        NOT NULL,
  reason              text        CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  movement_group_id   uuid        NOT NULL,
  idempotency_key     text        NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  recorded_by         uuid        NOT NULL REFERENCES app_user (id),
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, idempotency_key),
  FOREIGN KEY (organization_id, facility_id)  REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)   REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, procedure_id) REFERENCES clinic_procedure (organization_id, id),
  FOREIGN KEY (organization_id, location_id)  REFERENCES inventory_location (organization_id, id),
  CHECK (kind = 'issue' OR reason IS NOT NULL)
);
CREATE INDEX clinic_procedure_supply_use_procedure ON clinic_procedure_supply_use (organization_id, procedure_id, recorded_at);

-- What was issued (or returned): item and lot with a snapshot of what identified them (e.g. for a recall by lot). A
-- return line names the issued line it returns.
CREATE TABLE clinic_procedure_supply_use_line (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid        NOT NULL,
  supply_use_id          uuid        NOT NULL,
  inventory_item_id      uuid        NOT NULL,
  inventory_lot_id       uuid        NOT NULL,
  inventory_movement_id  uuid        NOT NULL REFERENCES inventory_movement (id),
  item_code              text        NOT NULL,
  item_name              text        NOT NULL,
  stock_unit             text        NOT NULL,
  lot_number             text,
  expiry_date            date,
  quantity               integer     NOT NULL CHECK (quantity > 0),
  returns_line_id        uuid,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, supply_use_id)     REFERENCES clinic_procedure_supply_use (organization_id, id),
  FOREIGN KEY (organization_id, inventory_item_id) REFERENCES inventory_item (organization_id, id),
  FOREIGN KEY (organization_id, inventory_lot_id)  REFERENCES inventory_lot (organization_id, id),
  FOREIGN KEY (organization_id, returns_line_id)   REFERENCES clinic_procedure_supply_use_line (organization_id, id)
);
CREATE INDEX clinic_procedure_supply_use_line_use ON clinic_procedure_supply_use_line (supply_use_id);
CREATE INDEX clinic_procedure_supply_use_line_lot ON clinic_procedure_supply_use_line (organization_id, inventory_lot_id);

CREATE TRIGGER clinic_procedure_supply_use_append_only BEFORE UPDATE OR DELETE ON clinic_procedure_supply_use
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER clinic_procedure_supply_use_line_append_only BEFORE UPDATE OR DELETE ON clinic_procedure_supply_use_line
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
