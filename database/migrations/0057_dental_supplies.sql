-- Dental supply use from inventory. See docs/domains/dental.md#supplies-used and docs/domains/inventory.md.
--
-- The organization configures, per dental procedure type, the supplies usually used (a template: inventory items and
-- quantities) and, per facility, the stock location dental supplies are taken from by default. After a procedure,
-- staff confirm what was actually used; the issue is posted through the inventory library's own command (first
-- expiry first out, never expired lots, balances never negative, controlled items need a reason and a reference) in
-- the same database transaction as the dental record of it. Unused supplies can be returned to the lot they came from.
--
-- Inventory ledger rows now say which record they were issued to or returned from (source type and id), so stock
-- history shows where supplies went; a new movement kind `return` puts stock back into the lot it was issued from.

-- ---- inventory: sourced movements and returns ------------------------------------------------------------

ALTER TABLE inventory_movement
  ADD COLUMN source_type text CHECK (source_type ~ '^[a-z][a-z_]{2,39}$'),
  ADD COLUMN source_id   uuid,
  ADD CONSTRAINT inventory_movement_source_check CHECK ((source_type IS NULL) = (source_id IS NULL));

ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_kind_check;
ALTER TABLE inventory_movement ADD CONSTRAINT inventory_movement_kind_check
  CHECK (kind IN ('receipt', 'issue', 'transfer_out', 'transfer_in', 'adjustment', 'write_off', 'return'));

-- Receipts, transfers in and returns add stock; issues, transfers out and write-offs remove it; counts go either way.
ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_check;
ALTER TABLE inventory_movement ADD CONSTRAINT inventory_movement_sign_check
  CHECK ((kind IN ('receipt', 'transfer_in', 'return')) = (quantity > 0) OR kind = 'adjustment');

-- A return always says why and which record the stock was issued to.
ALTER TABLE inventory_movement ADD CONSTRAINT inventory_movement_return_check
  CHECK (kind <> 'return' OR (reason IS NOT NULL AND source_type IS NOT NULL));

CREATE INDEX inventory_movement_source ON inventory_movement (organization_id, source_type, source_id) WHERE source_type IS NOT NULL;

-- ---- dental: default stock location per facility ---------------------------------------------------------

ALTER TABLE dental_facility_setting
  ADD COLUMN supply_location_id uuid,
  ADD CONSTRAINT dental_facility_setting_supply_location_fk
    FOREIGN KEY (organization_id, supply_location_id) REFERENCES inventory_location (organization_id, id);

-- ---- dental: supply templates (configuration) ------------------------------------------------------------

-- The supplies a procedure type usually uses. Configuration only: staff confirm (and change) what was used each time.
CREATE TABLE dental_supply_template_item (
  organization_id    uuid        NOT NULL,
  procedure_type_id  uuid        NOT NULL,
  inventory_item_id  uuid        NOT NULL,
  quantity           integer     NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  position           smallint    NOT NULL CHECK (position BETWEEN 0 AND 99),
  updated_by         uuid        NOT NULL REFERENCES app_user (id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (procedure_type_id, inventory_item_id),
  FOREIGN KEY (organization_id, procedure_type_id) REFERENCES dental_procedure_type (organization_id, id),
  FOREIGN KEY (organization_id, inventory_item_id) REFERENCES inventory_item (organization_id, id)
);

-- ---- dental: supplies used by a procedure ----------------------------------------------------------------

-- One confirmation of supplies used by a procedure (kind `issue`), or a return of unused supplies (kind `return`,
-- with a reason). Each is one inventory movement group, posted in the same transaction. Append-only.
CREATE TABLE dental_supply_use (
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
  FOREIGN KEY (patient_id, procedure_id)      REFERENCES dental_procedure (patient_id, id),
  FOREIGN KEY (organization_id, location_id)  REFERENCES inventory_location (organization_id, id),
  CHECK (kind = 'issue' OR reason IS NOT NULL)
);
CREATE INDEX dental_supply_use_procedure ON dental_supply_use (organization_id, procedure_id, recorded_at);

-- What was issued (or returned): the item and lot, with a snapshot of what identified them, for traceability (e.g. a
-- material recall by lot). A return line names the issued line it returns.
CREATE TABLE dental_supply_use_line (
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
  FOREIGN KEY (organization_id, supply_use_id)     REFERENCES dental_supply_use (organization_id, id),
  FOREIGN KEY (organization_id, inventory_item_id) REFERENCES inventory_item (organization_id, id),
  FOREIGN KEY (organization_id, inventory_lot_id)  REFERENCES inventory_lot (organization_id, id),
  FOREIGN KEY (organization_id, returns_line_id)   REFERENCES dental_supply_use_line (organization_id, id)
);
CREATE INDEX dental_supply_use_line_use ON dental_supply_use_line (supply_use_id);
CREATE INDEX dental_supply_use_line_lot ON dental_supply_use_line (organization_id, inventory_lot_id);

CREATE TRIGGER dental_supply_use_append_only BEFORE UPDATE OR DELETE ON dental_supply_use
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER dental_supply_use_line_append_only BEFORE UPDATE OR DELETE ON dental_supply_use_line
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
