-- Inventory wiring and procurement (Phase 9). See docs/domains/inventory.md.
--
-- 1. Stock used by other workflows: a movement can name its source (a prescription dispense, a reagent lot loaded on a
--    laboratory instrument, a purchase order line). Other domains take stock through the inventory library's contract
--    inside their own transaction; a reversal posts a "return" of exactly the lots taken, once.
-- 2. Purchase orders: drafted per facility and supplier for a delivery location, submitted, approved by someone else
--    (separation of duties, enforced here), received in one or more deliveries (receipts against the order's lines,
--    never more than ordered), then complete, or cancelled / closed short with a reason. Costs are integer centavos.
--    No government procurement rules (e.g. RA 9184 for public facilities) are encoded: they are compliance dependencies.
-- 3. Reorder quantity: with the reorder level, the quantity usually ordered (for suggestions).

-- ---- movement sources and returns -------------------------------------------------------------------

ALTER TABLE inventory_movement
  ADD COLUMN source_type text CHECK (source_type IN ('prescription_dispense', 'lab_reagent_load', 'purchase_order_line')),
  ADD COLUMN source_id   uuid,
  ADD CONSTRAINT inventory_movement_source_pair CHECK ((source_type IS NULL) = (source_id IS NULL));

ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_kind_check;
ALTER TABLE inventory_movement ADD CONSTRAINT inventory_movement_kind_check
  CHECK (kind IN ('receipt', 'issue', 'transfer_out', 'transfer_in', 'adjustment', 'write_off', 'return'));
ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_check;
ALTER TABLE inventory_movement ADD CONSTRAINT inventory_movement_sign_check
  CHECK ((kind IN ('receipt', 'transfer_in', 'return')) = (quantity > 0) OR kind = 'adjustment');
ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_check1;
ALTER TABLE inventory_movement ADD CONSTRAINT inventory_movement_reason_required
  CHECK (kind NOT IN ('adjustment', 'write_off', 'return') OR reason IS NOT NULL);
-- A return reverses an issue made for a source.
ALTER TABLE inventory_movement ADD CONSTRAINT inventory_movement_return_source CHECK (kind <> 'return' OR source_type IS NOT NULL);

-- A source takes stock from a lot once and gives it back at most once (receipts against an order line may repeat).
CREATE UNIQUE INDEX inventory_movement_source_once ON inventory_movement (organization_id, source_type, source_id, lot_id, kind)
  WHERE source_type IS NOT NULL AND kind IN ('issue', 'return');
CREATE INDEX inventory_movement_source ON inventory_movement (organization_id, source_type, source_id) WHERE source_type IS NOT NULL;

-- ---- reorder quantity -------------------------------------------------------------------------------

ALTER TABLE inventory_stock_level ADD COLUMN reorder_quantity integer CHECK (reorder_quantity > 0);

-- ---- purchase orders --------------------------------------------------------------------------------

CREATE TABLE inventory_number_sequence (
  organization_id  uuid    NOT NULL REFERENCES organization (id),
  series           text    NOT NULL CHECK (series IN ('purchase_order')),
  year             integer NOT NULL CHECK (year BETWEEN 2000 AND 9999),
  next_value       integer NOT NULL CHECK (next_value > 0),
  PRIMARY KEY (organization_id, series, year)
);

CREATE TABLE inventory_purchase_order (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES organization (id),
  facility_id       uuid        NOT NULL,
  -- PO-YYYY-NNNNNN, per organization and year.
  po_number         text        NOT NULL CHECK (po_number ~ '^PO-[0-9]{4}-[0-9]{6}$'),
  supplier_id       uuid        NOT NULL,
  -- Where the goods are delivered (a location of the facility).
  location_id       uuid        NOT NULL,
  status            text        NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'submitted', 'approved', 'partially_received', 'received', 'cancelled', 'closed')),
  expected_date     date,
  notes             text        CHECK (length(notes) <= 2000),
  created_by        uuid        NOT NULL REFERENCES app_user (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  submitted_by      uuid        REFERENCES app_user (id),
  submitted_at      timestamptz,
  approved_by       uuid        REFERENCES app_user (id),
  approved_at       timestamptz,
  ended_by          uuid        REFERENCES app_user (id),
  ended_at          timestamptz,
  -- Why the order was cancelled, or closed before everything arrived.
  end_reason        text        CHECK (length(btrim(end_reason)) BETWEEN 5 AND 500),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer     NOT NULL DEFAULT 1,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, po_number),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES inventory_supplier (organization_id, id),
  FOREIGN KEY (organization_id, location_id) REFERENCES inventory_location (organization_id, id),
  CHECK ((submitted_by IS NULL) = (submitted_at IS NULL)),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CHECK ((ended_by IS NULL) = (ended_at IS NULL)),
  CHECK (status = 'draft' OR status = 'cancelled' OR submitted_at IS NOT NULL),
  CHECK (status NOT IN ('approved', 'partially_received', 'received') OR approved_at IS NOT NULL),
  -- Separation of duties: whoever submits an order does not approve it.
  CHECK (approved_by IS NULL OR approved_by <> submitted_by),
  CHECK ((status IN ('cancelled', 'closed')) = (ended_at IS NOT NULL)),
  CHECK (status NOT IN ('cancelled', 'closed') OR end_reason IS NOT NULL)
);
CREATE INDEX inventory_purchase_order_facility ON inventory_purchase_order (organization_id, facility_id, status, created_at DESC);

CREATE TABLE inventory_purchase_order_line (
  id                 uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid     NOT NULL,
  purchase_order_id  uuid     NOT NULL,
  line_number        smallint NOT NULL CHECK (line_number BETWEEN 1 AND 200),
  item_id            uuid     NOT NULL,
  -- In the item's stock unit.
  quantity_ordered   integer  NOT NULL CHECK (quantity_ordered BETWEEN 1 AND 1000000),
  -- Centavos per stock unit, as agreed with the supplier (optional).
  unit_cost          bigint   CHECK (unit_cost >= 0),
  quantity_received  integer  NOT NULL DEFAULT 0 CHECK (quantity_received >= 0 AND quantity_received <= quantity_ordered),
  UNIQUE (organization_id, id),
  UNIQUE (purchase_order_id, line_number),
  UNIQUE (purchase_order_id, item_id),
  FOREIGN KEY (organization_id, purchase_order_id) REFERENCES inventory_purchase_order (organization_id, id),
  FOREIGN KEY (organization_id, item_id)           REFERENCES inventory_item (organization_id, id)
);

-- Lines change only while the order is a draft; afterwards only the received quantity grows.
CREATE FUNCTION inventory_purchase_order_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  order_status text;
BEGIN
  SELECT status INTO order_status FROM inventory_purchase_order WHERE id = coalesce(OLD.purchase_order_id, NEW.purchase_order_id);
  IF TG_OP = 'DELETE' THEN
    IF order_status <> 'draft' THEN RAISE EXCEPTION 'lines of a submitted purchase order are not removed' USING ERRCODE = 'insufficient_privilege'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF order_status <> 'draft' THEN RAISE EXCEPTION 'lines are added to draft purchase orders only' USING ERRCODE = 'insufficient_privilege'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.organization_id, NEW.purchase_order_id, NEW.id) IS DISTINCT FROM (OLD.organization_id, OLD.purchase_order_id, OLD.id) THEN
    RAISE EXCEPTION 'a purchase order line does not move' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF order_status <> 'draft' AND (NEW.line_number, NEW.item_id, NEW.quantity_ordered, NEW.unit_cost)
       IS DISTINCT FROM (OLD.line_number, OLD.item_id, OLD.quantity_ordered, OLD.unit_cost) THEN
    RAISE EXCEPTION 'a submitted purchase order line only records what was received' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.quantity_received < OLD.quantity_received THEN
    RAISE EXCEPTION 'received quantities only grow' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_purchase_order_line_history BEFORE INSERT OR UPDATE OR DELETE ON inventory_purchase_order_line
  FOR EACH ROW EXECUTE FUNCTION inventory_purchase_order_line_guard();

-- Purchase orders are kept: never deleted, and a finished one (received, cancelled, closed) no longer changes.
CREATE FUNCTION inventory_purchase_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'purchase orders are not deleted' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF OLD.status IN ('received', 'cancelled', 'closed') THEN
    RAISE EXCEPTION 'purchase order % is % and can no longer change', OLD.po_number, OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.organization_id, NEW.facility_id, NEW.po_number, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.organization_id, OLD.facility_id, OLD.po_number, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'a purchase order keeps its number, facility and author' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'draft' AND (NEW.supplier_id, NEW.location_id) IS DISTINCT FROM (OLD.supplier_id, OLD.location_id) THEN
    RAISE EXCEPTION 'the supplier and delivery location are fixed once the order is submitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_purchase_order_history BEFORE UPDATE OR DELETE ON inventory_purchase_order
  FOR EACH ROW EXECUTE FUNCTION inventory_purchase_order_guard();

-- ---- permissions ------------------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('inventory.procurement.manage',  'Draft, submit, cancel and close purchase orders; receive deliveries against them'),
  ('inventory.procurement.approve', 'Approve submitted purchase orders (never one you submitted)');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('org_admin', 'inventory.procurement.manage'),
  ('org_admin', 'inventory.procurement.approve'),
  ('inventory_officer', 'inventory.procurement.manage')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system
ON CONFLICT DO NOTHING;
