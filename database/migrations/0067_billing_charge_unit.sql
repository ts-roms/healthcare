-- Per-surface pricing for dental procedures. See docs/domains/billing.md ("Charge unit") and docs/domains/dental.md.
--
-- A billing service's price is per unit. A service mapped to a dental procedure may be charged per surface treated:
-- charge capture then records the procedure's number of surfaces (at least one) as the charge quantity, at the listed
-- unit price; dental fee estimates apply the same rule. Every other service is charged per item ('each').

ALTER TABLE billing_service
  ADD COLUMN charge_unit text NOT NULL DEFAULT 'each' CHECK (charge_unit IN ('each', 'surface')),
  ADD CONSTRAINT billing_service_surface_unit CHECK (charge_unit = 'each' OR source_kind = 'dental_procedure');
