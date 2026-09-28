-- Billing follow-ups: the organization's tax profile for documents (BIR as configuration), number series limits,
-- and deposits usable across the organization's facilities. See docs/domains/billing.md.
--
-- Nothing here encodes a BIR rule. The organization enters what its registration says — registered name, TIN,
-- address, VAT status and rate, permit reference (e.g. an Authority to Print or CAS permit, as issued) and any text
-- its accountant requires on documents — and classifies each service for VAT. When the profile says the
-- organization is VAT-registered, issuing an invoice records a VAT breakdown computed from those settings (prices
-- are VAT-inclusive; VAT on a line = net × rate ÷ (1 + rate), half up to the centavo). Whether those settings,
-- the breakdown and the documents meet BIR requirements (including VAT on statutory discounts) is a compliance
-- dependency to be verified with the organization's accountant and current issuances.

CREATE TABLE billing_organization_profile (
  organization_id            uuid        PRIMARY KEY REFERENCES organization (id),
  registered_name            text        CHECK (length(btrim(registered_name)) > 0),
  -- As registered; only digits and hyphens are accepted (the format itself is not validated here).
  tin                        text        CHECK (tin ~ '^[0-9][0-9-]{7,19}$'),
  business_address           text        CHECK (length(btrim(business_address)) > 0),
  vat_status                 text        NOT NULL DEFAULT 'not_configured' CHECK (vat_status IN ('not_configured', 'vat_registered', 'non_vat')),
  -- Basis points; entered by the organization, never defaulted.
  vat_rate_bp                integer     CHECK (vat_rate_bp BETWEEN 1 AND 10000),
  permit_reference           text        CHECK (length(btrim(permit_reference)) > 0),
  -- Text the organization's documents must carry, as its accountant instructs.
  document_note              text        CHECK (length(document_note) <= 500),
  -- Whether a patient's deposit and credit at one facility can be used at the organization's other facilities.
  deposits_across_facilities boolean     NOT NULL DEFAULT false,
  updated_by                 uuid        REFERENCES app_user (id),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  version                    integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK ((vat_status = 'vat_registered') = (vat_rate_bp IS NOT NULL))
);

-- VAT class of a service (null: not classified). A VAT-registered organization classifies what it invoices.
ALTER TABLE billing_service ADD COLUMN tax_class text CHECK (tax_class IN ('vatable', 'vat_exempt', 'zero_rated'));

-- The tax snapshot of an issued invoice.
ALTER TABLE billing_invoice_item ADD COLUMN tax_class text CHECK (tax_class IN ('vatable', 'vat_exempt', 'zero_rated'));
ALTER TABLE billing_invoice_item ADD COLUMN vat_amount bigint NOT NULL DEFAULT 0 CHECK (vat_amount >= 0);
ALTER TABLE billing_invoice_item ADD CONSTRAINT billing_invoice_item_vat_check CHECK (vat_amount <= net_amount);

ALTER TABLE billing_invoice ADD COLUMN tax_status text CHECK (tax_status IN ('not_configured', 'vat_registered', 'non_vat'));
ALTER TABLE billing_invoice ADD COLUMN vat_rate_bp integer CHECK (vat_rate_bp BETWEEN 1 AND 10000);
ALTER TABLE billing_invoice ADD COLUMN seller_registered_name text;
ALTER TABLE billing_invoice ADD COLUMN seller_tin text;
ALTER TABLE billing_invoice ADD COLUMN seller_address text;
ALTER TABLE billing_invoice ADD COLUMN permit_reference text;
ALTER TABLE billing_invoice ADD COLUMN document_note text;
-- Sales net of VAT, VAT, VAT-exempt and zero-rated sales (VAT-registered only; they add up to the net total).
ALTER TABLE billing_invoice ADD COLUMN vatable_sales bigint NOT NULL DEFAULT 0 CHECK (vatable_sales >= 0);
ALTER TABLE billing_invoice ADD COLUMN vat_amount bigint NOT NULL DEFAULT 0 CHECK (vat_amount >= 0);
ALTER TABLE billing_invoice ADD COLUMN vat_exempt_sales bigint NOT NULL DEFAULT 0 CHECK (vat_exempt_sales >= 0);
ALTER TABLE billing_invoice ADD COLUMN zero_rated_sales bigint NOT NULL DEFAULT 0 CHECK (zero_rated_sales >= 0);
ALTER TABLE billing_invoice ADD CONSTRAINT billing_invoice_vat_check CHECK (
  tax_status IS DISTINCT FROM 'vat_registered' OR vatable_sales + vat_amount + vat_exempt_sales + zero_rated_sales = net_total
);
ALTER TABLE billing_invoice ADD CONSTRAINT billing_invoice_vat_rate_check CHECK ((tax_status = 'vat_registered') = (vat_rate_bp IS NOT NULL));

-- Issued invoices stay immutable, now including their tax snapshot.
CREATE OR REPLACE FUNCTION billing_invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
    OR NEW.tax_status IS DISTINCT FROM OLD.tax_status OR NEW.vat_rate_bp IS DISTINCT FROM OLD.vat_rate_bp
    OR NEW.seller_registered_name IS DISTINCT FROM OLD.seller_registered_name OR NEW.seller_tin IS DISTINCT FROM OLD.seller_tin
    OR NEW.seller_address IS DISTINCT FROM OLD.seller_address OR NEW.permit_reference IS DISTINCT FROM OLD.permit_reference
    OR NEW.document_note IS DISTINCT FROM OLD.document_note
    OR NEW.vatable_sales <> OLD.vatable_sales OR NEW.vat_amount <> OLD.vat_amount
    OR NEW.vat_exempt_sales <> OLD.vat_exempt_sales OR NEW.zero_rated_sales <> OLD.zero_rated_sales
  ) THEN
    RAISE EXCEPTION 'issued invoices are immutable; void and reissue' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ---- number series limits -----------------------------------------------------------------------

-- The last number of the series the organization is authorized to use (none = no limit configured).
ALTER TABLE billing_sequence ADD COLUMN last_value bigint CHECK (last_value > 0);

-- ---- deposits across facilities -----------------------------------------------------------------

-- Balance moved between two facilities' accounts of one patient: a transfer_out at one and a transfer_in at the
-- other, sharing a transfer id, so each facility's balance stays derived from its own ledger and never negative.
ALTER TABLE billing_account_entry DROP CONSTRAINT billing_account_entry_kind_check;
ALTER TABLE billing_account_entry ADD CONSTRAINT billing_account_entry_kind_check
  CHECK (kind IN ('deposit', 'credit', 'application', 'release', 'refund', 'transfer_in', 'transfer_out'));
ALTER TABLE billing_account_entry ADD COLUMN transfer_id uuid;
ALTER TABLE billing_account_entry ADD COLUMN counterpart_facility_id uuid;
ALTER TABLE billing_account_entry ADD FOREIGN KEY (organization_id, counterpart_facility_id) REFERENCES facility (organization_id, id);
ALTER TABLE billing_account_entry ADD CONSTRAINT billing_account_entry_transfer_check
  CHECK ((kind IN ('transfer_in', 'transfer_out')) = (transfer_id IS NOT NULL AND counterpart_facility_id IS NOT NULL));
ALTER TABLE billing_account_entry ADD CONSTRAINT billing_account_entry_transfer_facility_check CHECK (counterpart_facility_id IS DISTINCT FROM facility_id);
CREATE UNIQUE INDEX billing_account_entry_transfer_uq ON billing_account_entry (transfer_id, kind) WHERE transfer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION billing_account_entry_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  balance bigint;
BEGIN
  IF NEW.kind IN ('application', 'refund', 'transfer_out') THEN
    SELECT coalesce(sum(CASE WHEN kind IN ('deposit', 'credit', 'release', 'transfer_in') THEN amount ELSE -amount END), 0) INTO balance
    FROM billing_account_entry
    WHERE organization_id = NEW.organization_id AND patient_id = NEW.patient_id AND facility_id = NEW.facility_id;
    IF NEW.amount > balance THEN
      RAISE EXCEPTION 'the patient account balance cannot go below zero' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.invoice_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM billing_invoice i WHERE i.id = NEW.invoice_id AND i.patient_id = NEW.patient_id AND i.facility_id = NEW.facility_id
  ) THEN
    RAISE EXCEPTION 'account entries apply to invoices of the same patient and facility' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
