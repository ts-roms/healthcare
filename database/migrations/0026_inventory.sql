-- Inventory (Phase 9). See docs/domains/inventory.md.
--
-- Medicines, supplies, laboratory reagents and consumables held at a facility's storage locations. Stock moves only
-- through an append-only ledger (receive, issue, transfer, adjust, write-off); the balance per location, item and lot
-- is maintained in the same transaction and can never go below zero (check constraint). Quantities are whole units of
-- the item's stock unit; costs, when recorded, are integer centavos (PHP).
--
-- Regulatory record-keeping for dangerous drugs and other controlled items (PDEA / Dangerous Drugs Board, FDA) is an
-- integration/compliance dependency: items can be flagged "controlled", which makes every movement require a reason and
-- a reference, but no official register format is implemented.

CREATE TABLE inventory_item (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  code             text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name             text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  category         text        NOT NULL CHECK (category IN ('medicine', 'medical_supply', 'reagent', 'laboratory_consumable', 'dental_supply', 'ppe', 'other')),
  -- The unit stock is counted in (e.g. tablet, vial, box of 100, test kit).
  stock_unit       text        NOT NULL CHECK (length(btrim(stock_unit)) BETWEEN 1 AND 40),
  tracks_lots      boolean     NOT NULL DEFAULT true,
  controlled       boolean     NOT NULL DEFAULT false,
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, code)
);

CREATE TABLE inventory_supplier (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  code             text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name             text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  contact          text        CHECK (length(contact) <= 300),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, code)
);

-- Where stock is kept: a pharmacy, laboratory store, dental cabinet, storeroom…
CREATE TABLE inventory_location (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  facility_id      uuid        NOT NULL,
  code             text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name             text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (facility_id, code),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id)
);

-- A lot (batch) of an item: number and expiry as printed by the manufacturer. Items that do not track lots use one
-- implicit lot with no number (lot_number NULL).
CREATE TABLE inventory_lot (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  item_id          uuid        NOT NULL,
  lot_number       text        CHECK (length(btrim(lot_number)) BETWEEN 1 AND 60),
  expiry_date      date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, item_id) REFERENCES inventory_item (organization_id, id)
);
CREATE UNIQUE INDEX inventory_lot_identity ON inventory_lot (item_id, coalesce(lot_number, ''), coalesce(expiry_date, 'infinity'::date));

-- Reorder level per location and item (optional).
CREATE TABLE inventory_stock_level (
  organization_id  uuid        NOT NULL,
  location_id      uuid        NOT NULL,
  item_id          uuid        NOT NULL,
  reorder_level    integer     NOT NULL CHECK (reorder_level >= 0),
  updated_by       uuid        NOT NULL REFERENCES app_user (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, item_id),
  FOREIGN KEY (organization_id, location_id) REFERENCES inventory_location (organization_id, id),
  FOREIGN KEY (organization_id, item_id)     REFERENCES inventory_item (organization_id, id)
);

-- Current stock per location and lot, maintained with every movement. Never negative.
CREATE TABLE inventory_balance (
  organization_id  uuid        NOT NULL,
  location_id      uuid        NOT NULL,
  item_id          uuid        NOT NULL,
  lot_id           uuid        NOT NULL,
  quantity         integer     NOT NULL CHECK (quantity >= 0),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, lot_id),
  FOREIGN KEY (organization_id, location_id) REFERENCES inventory_location (organization_id, id),
  FOREIGN KEY (organization_id, item_id)     REFERENCES inventory_item (organization_id, id),
  FOREIGN KEY (organization_id, lot_id)      REFERENCES inventory_lot (organization_id, id)
);
CREATE INDEX inventory_balance_item ON inventory_balance (organization_id, item_id);

-- The ledger: one row per location affected (a transfer is two rows sharing movement_group_id). Append-only.
CREATE TABLE inventory_movement (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL,
  movement_group_id  uuid        NOT NULL,
  kind               text        NOT NULL CHECK (kind IN ('receipt', 'issue', 'transfer_out', 'transfer_in', 'adjustment', 'write_off')),
  location_id        uuid        NOT NULL,
  item_id            uuid        NOT NULL,
  lot_id             uuid        NOT NULL,
  -- Signed: positive adds stock at the location, negative removes it.
  quantity           integer     NOT NULL CHECK (quantity <> 0),
  balance_after      integer     NOT NULL CHECK (balance_after >= 0),
  supplier_id        uuid,
  unit_cost          bigint      CHECK (unit_cost >= 0),
  -- Delivery receipt, requisition, count sheet… (free text reference).
  reference          text        CHECK (length(reference) <= 80),
  -- Who or what it was issued to (a department, a procedure) — no patient identifiers here.
  issued_to          text        CHECK (length(issued_to) <= 120),
  reason             text        CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  idempotency_key    text        CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  recorded_by        uuid        NOT NULL REFERENCES app_user (id),
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, location_id) REFERENCES inventory_location (organization_id, id),
  FOREIGN KEY (organization_id, item_id)     REFERENCES inventory_item (organization_id, id),
  FOREIGN KEY (organization_id, lot_id)      REFERENCES inventory_lot (organization_id, id),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES inventory_supplier (organization_id, id),
  CHECK ((kind IN ('receipt', 'transfer_in')) = (quantity > 0) OR kind = 'adjustment'),
  CHECK (kind NOT IN ('adjustment', 'write_off') OR reason IS NOT NULL),
  CHECK (kind = 'receipt' OR (supplier_id IS NULL AND unit_cost IS NULL))
);
CREATE INDEX inventory_movement_item ON inventory_movement (organization_id, item_id, recorded_at DESC);
CREATE INDEX inventory_movement_location ON inventory_movement (location_id, recorded_at DESC);
-- One movement per idempotency key (the first row of a group carries it).
CREATE UNIQUE INDEX inventory_movement_idempotency ON inventory_movement (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TRIGGER inventory_movement_append_only BEFORE UPDATE OR DELETE ON inventory_movement
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- permissions and roles --------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('inventory.read',            'View stock, lots, movements, low-stock and expiry lists'),
  ('inventory.move',            'Receive, issue and transfer stock'),
  ('inventory.adjust',          'Adjust counts and write off stock (with a reason)'),
  ('inventory.catalog.manage',  'Manage items, suppliers, storage locations and reorder levels');

INSERT INTO role (key, name, description, is_system) VALUES
  ('inventory_officer', 'Inventory officer', 'Stock receiving, issuing, counts and write-offs; inventory catalog', true);

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, p.key FROM role r CROSS JOIN permission p
WHERE r.key IN ('org_admin', 'inventory_officer') AND r.is_system AND p.key LIKE 'inventory.%'
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('inventory_officer', 'organization.read'),
  ('medical_technologist', 'inventory.read'), ('medical_technologist', 'inventory.move'),
  ('nurse', 'inventory.read'), ('nurse', 'inventory.move')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system
ON CONFLICT DO NOTHING;
