-- Prepaid online visits (docs/domains/billing.md, "Prepaid online consultations"; libs/billing/CLAUDE.md: a facility policy may
-- require payment before telemedicine).
--
-- When an organization requires payment before the waiting room (telemedicine_setting, migration 0125), billing charges the
-- online visit when the patient asks to enter it: a charge sourced from the appointment, an invoice made from that charge and
-- issued at once. Nobody on staff does that, so the invoice has no staff creator. The signed consultation does not charge the
-- visit type a second time (the encounter's capture checks for the appointment's charge).

ALTER TABLE billing_charge DROP CONSTRAINT billing_charge_source_type_check;
ALTER TABLE billing_charge ADD CONSTRAINT billing_charge_source_type_check
  CHECK (source_type IN ('encounter', 'lab_order_item', 'dental_procedure', 'clinic_procedure', 'manual', 'package', 'appointment'));

ALTER TABLE billing_invoice ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE billing_invoice ADD COLUMN created_via text NOT NULL DEFAULT 'staff' CHECK (created_via IN ('staff', 'system'));
ALTER TABLE billing_invoice ADD CONSTRAINT billing_invoice_creator CHECK ((created_via = 'staff') = (created_by IS NOT NULL));
