-- Billing follow-ups: packages. See docs/domains/billing.md.
--
-- A package (e.g. an annual physical examination) is a billable service of its own — so it has versioned prices
-- like any service — together with the services it includes and how many of each. Selling it to a patient at a
-- facility records an enrollment and a charge for the package at its price. While the enrollment is active (and not
-- past its end date), charges at that facility for included services are covered: charged at zero and counted
-- against what is left. What is left is derived from the charges (a cancelled charge gives its units back).

ALTER TABLE billing_service ADD COLUMN is_package boolean NOT NULL DEFAULT false;

CREATE TABLE billing_package_item (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL,
  -- The package (a billing service with is_package).
  package_service_id  uuid        NOT NULL,
  -- An included service (not itself a package).
  service_id          uuid        NOT NULL,
  quantity            integer     NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  UNIQUE (package_service_id, service_id),
  CHECK (package_service_id <> service_id),
  FOREIGN KEY (organization_id, package_service_id) REFERENCES billing_service (organization_id, id),
  FOREIGN KEY (organization_id, service_id)         REFERENCES billing_service (organization_id, id)
);

-- How long a sold package can be used, in days from the sale (none = until used up or cancelled).
ALTER TABLE billing_service ADD COLUMN package_validity_days integer CHECK (package_validity_days BETWEEN 1 AND 3660);
ALTER TABLE billing_service ADD CONSTRAINT billing_service_package_validity_check CHECK (is_package OR package_validity_days IS NULL);

CREATE TABLE billing_package_enrollment (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL,
  facility_id         uuid        NOT NULL,
  patient_id          uuid        NOT NULL,
  package_service_id  uuid        NOT NULL,
  status              text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  starts_on           date        NOT NULL,
  -- Last day it can be used (inclusive).
  ends_on             date,
  cancel_reason       text,
  sold_by             uuid        NOT NULL REFERENCES app_user (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id)        REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)         REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, package_service_id) REFERENCES billing_service (organization_id, id),
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL AND length(btrim(cancel_reason)) > 0))
);
CREATE INDEX billing_package_enrollment_patient_idx ON billing_package_enrollment (organization_id, patient_id, facility_id, status);

-- Charges: the sale of a package (source 'package', the enrollment) and charges a package covers.
ALTER TABLE billing_charge DROP CONSTRAINT billing_charge_source_type_check;
ALTER TABLE billing_charge ADD CONSTRAINT billing_charge_source_type_check CHECK (source_type IN ('encounter', 'lab_order_item', 'dental_procedure', 'manual', 'package'));
-- Staff enter manual charges and sell packages; clinical sources are captured by the system.
ALTER TABLE billing_charge DROP CONSTRAINT billing_charge_check1;
ALTER TABLE billing_charge ADD CONSTRAINT billing_charge_captured_by_check CHECK ((source_type IN ('manual', 'package')) = (captured_by IS NOT NULL));
ALTER TABLE billing_charge ADD COLUMN package_enrollment_id uuid;
ALTER TABLE billing_charge ADD FOREIGN KEY (organization_id, package_enrollment_id) REFERENCES billing_package_enrollment (organization_id, id);
-- A covered charge is charged at zero.
ALTER TABLE billing_charge ADD CONSTRAINT billing_charge_covered_check CHECK (package_enrollment_id IS NULL OR unit_price = 0);
CREATE INDEX billing_charge_enrollment_idx ON billing_charge (package_enrollment_id) WHERE package_enrollment_id IS NOT NULL;
