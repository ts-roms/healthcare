-- Inventory valuation and supplier invoices. See docs/domains/inventory.md ("Valuation", "Supplier invoices").
--
-- 1. Valuation: a lot's cost is the weighted average of its priced receipts (purchase-order price or the cost entered
--    on a manual receipt). Every other movement records the lot's cost when it is posted, so the value of what was
--    issued, dispensed, used or written off never changes afterwards. Lots with no priced receipt are unvalued.
--    Operational figures for stock control, not an accounting or BIR valuation.
-- 2. Supplier invoices: recorded against a purchase order line by line (never more than was received, net of other
--    invoices), approved by someone other than the recorder, then marked paid with a reference, or voided with a reason.
--    Price differences from the order are shown, not applied to stock cost.

-- ---- 1. cost on every movement ------------------------------------------------------------------------------------

ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_check2;
ALTER TABLE inventory_movement ADD CONSTRAINT inventory_movement_supplier_on_receipt CHECK (kind = 'receipt' OR supplier_id IS NULL);

-- A lot's priced receipts, read when a movement is posted and when stock is valued.
CREATE INDEX inventory_movement_lot_cost ON inventory_movement (lot_id) WHERE kind = 'receipt' AND unit_cost IS NOT NULL;
-- Movements of a period (value used, purchases).
CREATE INDEX inventory_movement_recorded ON inventory_movement (organization_id, recorded_at);

-- ---- 2. supplier invoices -----------------------------------------------------------------------------------------

ALTER TABLE inventory_purchase_order_line ADD CONSTRAINT inventory_purchase_order_line_order_id UNIQUE (purchase_order_id, id);

CREATE TABLE inventory_supplier_invoice (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL REFERENCES organization (id),
  facility_id         uuid        NOT NULL,
  purchase_order_id   uuid        NOT NULL,
  supplier_id         uuid        NOT NULL,
  -- The supplier's own invoice number, as printed.
  invoice_number      text        NOT NULL CHECK (length(btrim(invoice_number)) BETWEEN 1 AND 60),
  invoice_date        date        NOT NULL,
  due_date            date,
  -- Centavos: the sum of the lines, the VAT as stated on the invoice, and their total.
  lines_total         bigint      NOT NULL CHECK (lines_total >= 0),
  vat_amount          bigint      NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  total               bigint      NOT NULL,
  notes               text        CHECK (length(notes) <= 1000),
  status              text        NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'approved', 'paid', 'void')),
  recorded_by         uuid        NOT NULL REFERENCES app_user (id),
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  approved_by         uuid        REFERENCES app_user (id),
  approved_at         timestamptz,
  approval_note       text        CHECK (length(btrim(approval_note)) BETWEEN 3 AND 500),
  paid_on             date,
  payment_reference   text        CHECK (length(btrim(payment_reference)) BETWEEN 1 AND 80),
  paid_recorded_by    uuid        REFERENCES app_user (id),
  paid_recorded_at    timestamptz,
  voided_by           uuid        REFERENCES app_user (id),
  voided_at           timestamptz,
  void_reason         text        CHECK (length(btrim(void_reason)) BETWEEN 5 AND 500),
  version             integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (id, purchase_order_id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, purchase_order_id) REFERENCES inventory_purchase_order (organization_id, id),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES inventory_supplier (organization_id, id),
  CHECK (total = lines_total + vat_amount),
  CHECK (due_date IS NULL OR due_date >= invoice_date),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  -- Separation of duties: whoever recorded the invoice does not approve it.
  CHECK (approved_by IS NULL OR approved_by <> recorded_by),
  CHECK (status NOT IN ('approved', 'paid') OR approved_at IS NOT NULL),
  CHECK ((status = 'paid') = (paid_on IS NOT NULL)),
  CHECK ((paid_on IS NULL) = (payment_reference IS NULL) AND (paid_on IS NULL) = (paid_recorded_by IS NULL) AND (paid_on IS NULL) = (paid_recorded_at IS NULL)),
  CHECK ((status = 'void') = (voided_at IS NOT NULL)),
  CHECK ((voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL))
);

-- One valid invoice per supplier invoice number (a voided one can be recorded again).
CREATE UNIQUE INDEX inventory_supplier_invoice_number ON inventory_supplier_invoice (organization_id, supplier_id, lower(btrim(invoice_number)))
  WHERE status <> 'void';
CREATE INDEX inventory_supplier_invoice_order ON inventory_supplier_invoice (purchase_order_id);
CREATE INDEX inventory_supplier_invoice_open ON inventory_supplier_invoice (organization_id, facility_id, status, due_date);

CREATE TABLE inventory_supplier_invoice_line (
  id                      uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid    NOT NULL REFERENCES organization (id),
  invoice_id              uuid    NOT NULL,
  purchase_order_id       uuid    NOT NULL,
  purchase_order_line_id  uuid    NOT NULL,
  quantity                integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  -- Centavos per stock unit, as invoiced.
  unit_price              bigint  NOT NULL CHECK (unit_price >= 0),
  amount                  bigint  NOT NULL,
  UNIQUE (invoice_id, purchase_order_line_id),
  FOREIGN KEY (organization_id, invoice_id) REFERENCES inventory_supplier_invoice (organization_id, id),
  -- The line belongs to the invoice's purchase order.
  FOREIGN KEY (invoice_id, purchase_order_id) REFERENCES inventory_supplier_invoice (id, purchase_order_id),
  FOREIGN KEY (purchase_order_id, purchase_order_line_id) REFERENCES inventory_purchase_order_line (purchase_order_id, id),
  CHECK (amount = quantity * unit_price)
);

CREATE INDEX inventory_supplier_invoice_line_po_line ON inventory_supplier_invoice_line (purchase_order_line_id);

CREATE TRIGGER inventory_supplier_invoice_line_append_only BEFORE UPDATE OR DELETE ON inventory_supplier_invoice_line
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- An invoice's content never changes; only its status moves forward (recorded → approved → paid; recorded or approved →
-- void), with who and when. Nothing is deleted.
CREATE FUNCTION inventory_supplier_invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'supplier invoices are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.organization_id, NEW.facility_id, NEW.purchase_order_id, NEW.supplier_id, NEW.invoice_number, NEW.invoice_date, NEW.due_date,
      NEW.lines_total, NEW.vat_amount, NEW.total, NEW.notes, NEW.recorded_by, NEW.recorded_at)
     IS DISTINCT FROM
     (OLD.organization_id, OLD.facility_id, OLD.purchase_order_id, OLD.supplier_id, OLD.invoice_number, OLD.invoice_date, OLD.due_date,
      OLD.lines_total, OLD.vat_amount, OLD.total, OLD.notes, OLD.recorded_by, OLD.recorded_at) THEN
    RAISE EXCEPTION 'a supplier invoice is not edited; void it and record it again' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('paid', 'void') THEN
    RAISE EXCEPTION 'a paid or voided supplier invoice does not change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT ((OLD.status = 'recorded' AND NEW.status IN ('approved', 'void'))
       OR (OLD.status = 'approved' AND NEW.status IN ('paid', 'void'))) THEN
    RAISE EXCEPTION 'supplier invoice status % cannot become %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.approved_at IS NOT NULL AND (NEW.approved_by, NEW.approved_at, NEW.approval_note) IS DISTINCT FROM (OLD.approved_by, OLD.approved_at, OLD.approval_note) THEN
    RAISE EXCEPTION 'an approval is not changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER inventory_supplier_invoice_history BEFORE UPDATE OR DELETE ON inventory_supplier_invoice
  FOR EACH ROW EXECUTE FUNCTION inventory_supplier_invoice_guard();

-- ---- permissions --------------------------------------------------------------------------------------------------

INSERT INTO permission (key, description)
VALUES ('inventory.valuation.read', 'View stock values and the cost of stock received, used and written off');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'inventory.valuation.read' FROM role r
WHERE r.key IN ('org_admin', 'inventory_officer') AND r.is_system
ON CONFLICT DO NOTHING;
