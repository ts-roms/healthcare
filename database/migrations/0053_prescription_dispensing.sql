-- Dispensing from prescriptions (Phase 9). See docs/domains/prescription.md.
--
-- A pharmacist (or nurse) dispenses an item of an active prescription from a storage location of their facility: the
-- stock leaves inventory in the same transaction (lots first-expiry-first-out, never expired), and the dispense records
-- which inventory item, how much (in the item's stock unit) and the stock movement group. A mistaken dispense is
-- reversed with a reason: the same lots return to the same location, once. Dispenses are never deleted.
--
-- Regulatory dispensing records (e.g. the dangerous drugs register, special prescription forms for controlled
-- substances) are compliance dependencies: controlled items only require the prescription number as the movement
-- reference and a reason, as every controlled movement does.

CREATE TABLE prescription_dispense (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid        NOT NULL,
  facility_id                 uuid        NOT NULL,
  prescription_id             uuid        NOT NULL,
  prescription_item_id        uuid        NOT NULL REFERENCES prescription_item (id),
  patient_id                  uuid        NOT NULL,
  inventory_item_id           uuid        NOT NULL,
  location_id                 uuid        NOT NULL,
  -- In the inventory item's stock unit (snapshot below), which can differ from the prescribed unit.
  quantity                    integer     NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
  item_name                   text        NOT NULL,
  stock_unit                  text        NOT NULL,
  stock_movement_group_id     uuid        NOT NULL,
  note                        text        CHECK (length(note) <= 500),
  dispensed_by                uuid        NOT NULL REFERENCES app_user (id),
  dispensed_at                timestamptz NOT NULL DEFAULT now(),
  status                      text        NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'reversed')),
  reversed_by                 uuid        REFERENCES app_user (id),
  reversed_at                 timestamptz,
  reversal_reason             text        CHECK (length(btrim(reversal_reason)) BETWEEN 5 AND 500),
  reversal_movement_group_id  uuid,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id)       REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, prescription_id)   REFERENCES prescription (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)        REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, inventory_item_id) REFERENCES inventory_item (organization_id, id),
  FOREIGN KEY (organization_id, location_id)       REFERENCES inventory_location (organization_id, id),
  CHECK ((status = 'reversed') = (reversed_at IS NOT NULL)),
  CHECK ((reversed_at IS NULL) = (reversed_by IS NULL)),
  CHECK (reversed_at IS NULL OR (reversal_reason IS NOT NULL AND reversal_movement_group_id IS NOT NULL))
);
CREATE INDEX prescription_dispense_prescription ON prescription_dispense (prescription_id, dispensed_at);
CREATE INDEX prescription_dispense_facility ON prescription_dispense (organization_id, facility_id, dispensed_at DESC);

-- The item belongs to the prescription (and so to its patient).
CREATE FUNCTION prescription_dispense_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'dispenses are not deleted' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM prescription_item i JOIN prescription p ON p.id = i.prescription_id
      WHERE i.id = NEW.prescription_item_id AND p.id = NEW.prescription_id AND p.patient_id = NEW.patient_id
    ) THEN
      RAISE EXCEPTION 'the item is not part of this prescription' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'recorded'
     OR (NEW.id, NEW.organization_id, NEW.facility_id, NEW.prescription_id, NEW.prescription_item_id, NEW.patient_id, NEW.inventory_item_id,
         NEW.location_id, NEW.quantity, NEW.item_name, NEW.stock_unit, NEW.stock_movement_group_id, NEW.note, NEW.dispensed_by, NEW.dispensed_at)
        IS DISTINCT FROM
        (OLD.id, OLD.organization_id, OLD.facility_id, OLD.prescription_id, OLD.prescription_item_id, OLD.patient_id, OLD.inventory_item_id,
         OLD.location_id, OLD.quantity, OLD.item_name, OLD.stock_unit, OLD.stock_movement_group_id, OLD.note, OLD.dispensed_by, OLD.dispensed_at) THEN
    RAISE EXCEPTION 'a dispense only changes when it is reversed, once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prescription_dispense_history BEFORE INSERT OR UPDATE OR DELETE ON prescription_dispense
  FOR EACH ROW EXECUTE FUNCTION prescription_dispense_guard();

-- ---- permissions and roles --------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('prescription.dispense', 'Dispense prescribed items from stock and reverse mistaken dispenses');

INSERT INTO role (key, name, description, is_system) VALUES
  ('pharmacist', 'Pharmacist', 'Dispensing from prescriptions; pharmacy stock', true);

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('pharmacist', 'organization.read'),
  ('pharmacist', 'patient.search'),
  ('pharmacist', 'patient.read'),
  ('pharmacist', 'prescription.read'),
  ('pharmacist', 'prescription.dispense'),
  ('pharmacist', 'inventory.read'),
  ('pharmacist', 'inventory.move'),
  ('nurse', 'prescription.dispense'),
  ('org_admin', 'prescription.dispense')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system
ON CONFLICT DO NOTHING;
