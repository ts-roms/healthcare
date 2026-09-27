-- Billing (Phase 7). See docs/domains/billing.md and libs/billing/CLAUDE.md.
--
-- Money is stored as integer centavos (bigint, PHP) everywhere; never floating point.
-- Billing is separate from clinical logic: charges reference their clinical source by type and id only
-- (no foreign keys into clinical tables) and are captured from domain events or by staff.
-- Issued invoices are immutable (trigger): corrections are void + reissue, with a reason.
-- Payments and refunds are an append-only ledger with idempotency keys.
--
-- Compliance dependencies (not implemented as rules here): BIR invoicing/official receipt format and
-- numbering, VAT treatment, and statutory discount rates/coverage (RA 9994, RA 10754) must be verified
-- against current official issuances; they are configuration.

-- ---- catalog ----------------------------------------------------------------------------------

-- A billable service. Clinical sources map to services by code (a visit type's code, a laboratory test's code).
CREATE TABLE billing_service (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  code             text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name             text        NOT NULL CHECK (length(btrim(name)) > 0),
  category         text        NOT NULL CHECK (category IN ('consultation', 'procedure', 'laboratory', 'dental', 'telemedicine', 'supply', 'other')),
  -- What captures this service automatically: a visit type (on a signed encounter) or a laboratory test (on ordering).
  source_kind      text        CHECK (source_kind IN ('visit_type', 'lab_test')),
  source_code      text,
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, code),
  CHECK ((source_kind IS NULL) = (source_code IS NULL))
);
CREATE UNIQUE INDEX billing_service_source_uq ON billing_service (organization_id, source_kind, source_code) WHERE source_kind IS NOT NULL;

-- Versioned prices with effective dates; invoices snapshot the price used.
CREATE TABLE billing_service_price (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  service_id        uuid        NOT NULL,
  unit_price        bigint      NOT NULL CHECK (unit_price >= 0),
  effective_from    date        NOT NULL,
  effective_until   date,
  created_by        uuid        NOT NULL REFERENCES app_user (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, service_id) REFERENCES billing_service (organization_id, id),
  CHECK (effective_until IS NULL OR effective_until >= effective_from),
  EXCLUDE USING gist (service_id WITH =, daterange(effective_from, effective_until, '[]') WITH &&)
);

-- Payers other than the patient: HMOs, PhilHealth, insurers, companies.
CREATE TABLE billing_payer (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  code             text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name             text        NOT NULL CHECK (length(btrim(name)) > 0),
  payer_type       text        NOT NULL CHECK (payer_type IN ('hmo', 'philhealth', 'insurance', 'company', 'other')),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, code)
);

-- Discount rules, including statutory ones (Senior Citizen, PWD). Rates are configuration to be verified
-- against current issuances; a new version is a new row (old invoices keep the rule they used).
CREATE TABLE billing_discount_rule (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES organization (id),
  code               text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name               text        NOT NULL CHECK (length(btrim(name)) > 0),
  kind               text        NOT NULL CHECK (kind IN ('senior_citizen', 'pwd', 'employee', 'promotional', 'other')),
  statutory          boolean     NOT NULL DEFAULT false,
  -- Percentage in basis points (2000 = 20%).
  rate_bp            integer     NOT NULL CHECK (rate_bp BETWEEN 1 AND 10000),
  -- Service categories the discount applies to; empty means all.
  categories         text[]      NOT NULL DEFAULT '{}',
  -- An ID number (e.g. OSCA or PWD ID) must be recorded when applying it.
  requires_evidence  boolean     NOT NULL DEFAULT false,
  -- Whether it may be combined with another discount on the same invoice.
  stackable          boolean     NOT NULL DEFAULT false,
  effective_from     date        NOT NULL,
  effective_until    date,
  status             text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by         uuid        NOT NULL REFERENCES app_user (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CHECK (NOT statutory OR requires_evidence),
  CHECK (effective_until IS NULL OR effective_until >= effective_from),
  CHECK (categories <@ ARRAY['consultation', 'procedure', 'laboratory', 'dental', 'telemedicine', 'supply', 'other']::text[])
);

-- Document numbers per organization and kind (format and series are a BIR compliance dependency).
CREATE TABLE billing_sequence (
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  kind             text        NOT NULL CHECK (kind IN ('invoice', 'receipt')),
  prefix           text        NOT NULL CHECK (prefix ~ '^[A-Z0-9-]{1,12}$'),
  next_value       bigint      NOT NULL DEFAULT 1 CHECK (next_value > 0),
  PRIMARY KEY (organization_id, kind)
);

-- ---- charges ----------------------------------------------------------------------------------

CREATE TABLE billing_charge (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  facility_id       uuid        NOT NULL,
  patient_id        uuid        NOT NULL,
  service_id        uuid        NOT NULL,
  -- Where the charge came from: a signed encounter, a laboratory order item, or staff entry.
  source_type       text        NOT NULL CHECK (source_type IN ('encounter', 'lab_order_item', 'manual')),
  source_id         uuid,
  -- Groups charges of one clinical document (e.g. the laboratory order of several items).
  source_group_id   uuid,
  description       text        NOT NULL CHECK (length(btrim(description)) > 0),
  quantity          integer     NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 1000),
  unit_price        bigint      NOT NULL CHECK (unit_price >= 0),
  price_id          uuid        REFERENCES billing_service_price (id),
  service_date      date        NOT NULL,
  status            text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'invoiced', 'cancelled')),
  invoice_id        uuid,
  cancel_reason     text,
  captured_by       uuid        REFERENCES app_user (id),
  captured_at       timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)  REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, service_id)  REFERENCES billing_service (organization_id, id),
  CHECK ((source_type = 'manual') = (source_id IS NULL)),
  CHECK ((source_type = 'manual') = (captured_by IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL AND length(btrim(cancel_reason)) > 0)),
  -- On an invoice (a draft reserves it; discarding the draft or voiding the invoice releases it).
  CHECK ((status = 'invoiced') = (invoice_id IS NOT NULL))
);
-- Captured once per clinical source and service, however often the event is delivered.
CREATE UNIQUE INDEX billing_charge_source_uq ON billing_charge (organization_id, source_type, source_id, service_id) WHERE source_id IS NOT NULL;
CREATE INDEX billing_charge_patient_idx ON billing_charge (organization_id, patient_id, status);

-- ---- invoices ---------------------------------------------------------------------------------

CREATE TABLE billing_invoice (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  facility_id       uuid        NOT NULL,
  patient_id        uuid        NOT NULL,
  -- Assigned on issue.
  invoice_number    text,
  status            text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'void')),
  gross_total       bigint      NOT NULL DEFAULT 0 CHECK (gross_total >= 0),
  discount_total    bigint      NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  net_total         bigint      NOT NULL DEFAULT 0 CHECK (net_total >= 0),
  payer_total       bigint      NOT NULL DEFAULT 0 CHECK (payer_total >= 0),
  patient_total     bigint      NOT NULL DEFAULT 0 CHECK (patient_total >= 0),
  notes             text,
  created_by        uuid        NOT NULL REFERENCES app_user (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  issued_at         timestamptz,
  issued_by         uuid        REFERENCES app_user (id),
  voided_at         timestamptz,
  voided_by         uuid        REFERENCES app_user (id),
  void_reason       text,
  -- The invoice issued in place of this one (void + reissue).
  replaced_by_id    uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, invoice_number),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)  REFERENCES patient (organization_id, id),
  CHECK (net_total = gross_total - discount_total),
  CHECK (patient_total = net_total - payer_total),
  CHECK ((status = 'draft') = (invoice_number IS NULL)),
  CHECK ((status = 'draft') = (issued_at IS NULL)),
  CHECK ((status = 'void') = (voided_at IS NOT NULL AND length(btrim(void_reason)) > 0))
);
CREATE INDEX billing_invoice_facility_idx ON billing_invoice (facility_id, status, issued_at);
CREATE INDEX billing_invoice_patient_idx ON billing_invoice (organization_id, patient_id, status);

ALTER TABLE billing_charge ADD FOREIGN KEY (organization_id, invoice_id) REFERENCES billing_invoice (organization_id, id);

CREATE TABLE billing_invoice_item (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  invoice_id        uuid        NOT NULL,
  charge_id         uuid        NOT NULL,
  service_id        uuid        NOT NULL,
  category          text        NOT NULL,
  description       text        NOT NULL,
  service_date      date        NOT NULL,
  quantity          integer     NOT NULL CHECK (quantity > 0),
  unit_price        bigint      NOT NULL CHECK (unit_price >= 0),
  gross_amount      bigint      NOT NULL CHECK (gross_amount = unit_price * quantity),
  discount_amount   bigint      NOT NULL DEFAULT 0 CHECK (discount_amount >= 0 AND discount_amount <= gross_amount),
  net_amount        bigint      NOT NULL CHECK (net_amount = gross_amount - discount_amount),
  UNIQUE (invoice_id, charge_id),
  FOREIGN KEY (organization_id, invoice_id) REFERENCES billing_invoice (organization_id, id),
  FOREIGN KEY (organization_id, charge_id)  REFERENCES billing_charge (organization_id, id)
);

-- Discounts applied to an invoice, with the rule version and the eligibility evidence.
CREATE TABLE billing_invoice_discount (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  invoice_id        uuid        NOT NULL,
  rule_id           uuid        NOT NULL,
  rule_code         text        NOT NULL,
  rule_name         text        NOT NULL,
  rate_bp           integer     NOT NULL,
  evidence_id_number text,
  evidence_note     text,
  amount            bigint      NOT NULL CHECK (amount >= 0),
  applied_by        uuid        NOT NULL REFERENCES app_user (id),
  applied_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, rule_id),
  FOREIGN KEY (organization_id, invoice_id) REFERENCES billing_invoice (organization_id, id),
  FOREIGN KEY (organization_id, rule_id)    REFERENCES billing_discount_rule (organization_id, id)
);

-- What payers other than the patient are expected to cover (HMO LOA, PhilHealth, insurer).
CREATE TABLE billing_invoice_payer (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  invoice_id        uuid        NOT NULL,
  payer_id          uuid        NOT NULL,
  amount            bigint      NOT NULL CHECK (amount > 0),
  -- LOA / approval / claim number.
  reference         text,
  status            text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'settled', 'denied')),
  settled_amount    bigint      CHECK (settled_amount >= 0),
  status_note       text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid        NOT NULL REFERENCES app_user (id),
  UNIQUE (invoice_id, payer_id),
  FOREIGN KEY (organization_id, invoice_id) REFERENCES billing_invoice (organization_id, id),
  FOREIGN KEY (organization_id, payer_id)   REFERENCES billing_payer (organization_id, id),
  CHECK ((status = 'settled') = (settled_amount IS NOT NULL))
);

-- Issued invoices cannot change, except to become void. Their items, discounts and payer amounts
-- cannot change either (payer status updates are allowed: claims move on after issue).
CREATE FUNCTION billing_invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'issued invoices cannot be deleted' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'void' THEN RAISE EXCEPTION 'void invoices cannot change' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status = 'issued' AND (
       NEW.status NOT IN ('issued', 'void')
    OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
    OR NEW.gross_total <> OLD.gross_total OR NEW.discount_total <> OLD.discount_total
    OR NEW.payer_total <> OLD.payer_total OR NEW.patient_total <> OLD.patient_total
    OR NEW.patient_id <> OLD.patient_id OR NEW.facility_id <> OLD.facility_id
    OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
  ) THEN
    RAISE EXCEPTION 'issued invoices are immutable; void and reissue' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER billing_invoice_immutable BEFORE UPDATE OR DELETE ON billing_invoice FOR EACH ROW EXECUTE FUNCTION billing_invoice_guard();

CREATE FUNCTION billing_invoice_part_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN target := OLD.invoice_id; ELSE target := NEW.invoice_id; END IF;
  -- Claim status and settlement follow-up on a payer line stay possible after issue.
  -- (Nested IFs: PL/pgSQL does not short-circuit, and other tables have no amount column.)
  IF TG_TABLE_NAME = 'billing_invoice_payer' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.amount = OLD.amount AND NEW.payer_id = OLD.payer_id AND NEW.invoice_id = OLD.invoice_id THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM billing_invoice WHERE id = target AND status <> 'draft') THEN
    RAISE EXCEPTION 'lines of an issued invoice cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER billing_invoice_item_immutable BEFORE INSERT OR UPDATE OR DELETE ON billing_invoice_item FOR EACH ROW EXECUTE FUNCTION billing_invoice_part_guard();
CREATE TRIGGER billing_invoice_discount_immutable BEFORE INSERT OR UPDATE OR DELETE ON billing_invoice_discount FOR EACH ROW EXECUTE FUNCTION billing_invoice_part_guard();
CREATE TRIGGER billing_invoice_payer_immutable BEFORE INSERT OR UPDATE OR DELETE ON billing_invoice_payer FOR EACH ROW EXECUTE FUNCTION billing_invoice_part_guard();

-- ---- payments (ledger) ------------------------------------------------------------------------

CREATE TABLE billing_payment (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL,
  facility_id        uuid        NOT NULL,
  invoice_id         uuid        NOT NULL,
  patient_id         uuid        NOT NULL,
  kind               text        NOT NULL CHECK (kind IN ('payment', 'refund')),
  amount             bigint      NOT NULL CHECK (amount > 0),
  method             text        NOT NULL CHECK (method IN ('cash', 'card', 'e_wallet', 'bank_transfer', 'check', 'other')),
  -- Card approval code, e-wallet or bank reference, check number.
  reference          text,
  receipt_number     text,
  -- A refund points to the payment it returns.
  refund_of_id       uuid,
  reason             text,
  idempotency_key    text        NOT NULL,
  recorded_by        uuid        NOT NULL REFERENCES app_user (id),
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, receipt_number),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, invoice_id)  REFERENCES billing_invoice (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)  REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, refund_of_id) REFERENCES billing_payment (organization_id, id),
  CHECK ((kind = 'refund') = (refund_of_id IS NOT NULL)),
  CHECK (kind = 'payment' OR length(btrim(reason)) > 0)
);
CREATE INDEX billing_payment_invoice_idx ON billing_payment (invoice_id);
CREATE INDEX billing_payment_facility_idx ON billing_payment (facility_id, recorded_at);

CREATE TRIGGER billing_payment_append_only BEFORE UPDATE OR DELETE ON billing_payment FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- permissions and roles --------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('billing.charge.read',       'View charges, invoices and payments'),
  ('billing.charge.capture',    'Add manual charges and cancel uninvoiced charges'),
  ('billing.invoice.issue',     'Prepare and issue invoices, set payer coverage'),
  ('billing.invoice.void',      'Void issued invoices (with a reason)'),
  ('billing.payment.record',    'Record patient payments'),
  ('billing.refund.issue',      'Refund payments (with a reason)'),
  ('billing.discount.apply',    'Apply discounts, including statutory discounts with evidence'),
  ('billing.pricelist.manage',  'Manage billable services, prices, payers and discount rules'),
  ('billing.report.read',       'View billing reports (collections, receivables)');

INSERT INTO role (key, name, description, is_system) VALUES
  ('cashier', 'Cashier', 'Billing: invoices, discounts and payments at a facility', true);

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, p.key FROM role r CROSS JOIN permission p
WHERE r.key = 'org_admin' AND r.is_system
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('cashier', 'billing.charge.read'), ('cashier', 'billing.charge.capture'), ('cashier', 'billing.invoice.issue'),
  ('cashier', 'billing.payment.record'), ('cashier', 'billing.discount.apply'), ('cashier', 'billing.report.read'),
  ('cashier', 'patient.search'), ('cashier', 'patient.read'),
  ('receptionist', 'billing.charge.read')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system;
