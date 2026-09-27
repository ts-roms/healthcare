-- Billing follow-ups: patient deposits (advance payments) and credit notes. See docs/domains/billing.md.
--
-- Money stays integer centavos (bigint, PHP). Both are append-only: corrections are new entries or documents.
--
-- Patient account (per patient and facility): an append-only ledger of deposits received, credit from credit notes,
-- applications to issued invoices, their release when an invoice is voided, and refunds. The balance is derived from
-- the ledger; it can never go below zero (checked here and, under a lock, by the service).
--
-- Credit notes: the correction of an issued invoice besides void + reissue. A credit note references an issued
-- invoice and some of its lines, has a reason and its own configurable number series, and is immutable. What it
-- credits reduces the invoice balance; what was already paid becomes account credit (refundable or applicable).
--
-- Compliance dependencies (not implemented as rules here): whether credit notes and deposit acknowledgement receipts
-- meet BIR requirements (format, numbering, VAT adjustment) must be verified; prefixes and series are configuration.

-- ---- numbering ----------------------------------------------------------------------------------

ALTER TABLE billing_sequence DROP CONSTRAINT billing_sequence_kind_check;
ALTER TABLE billing_sequence ADD CONSTRAINT billing_sequence_kind_check CHECK (kind IN ('invoice', 'receipt', 'credit_note'));

-- ---- credit notes -------------------------------------------------------------------------------

CREATE TABLE billing_credit_note (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL,
  facility_id         uuid        NOT NULL,
  patient_id          uuid        NOT NULL,
  invoice_id          uuid        NOT NULL,
  credit_note_number  text        NOT NULL,
  reason              text        NOT NULL CHECK (length(btrim(reason)) >= 3),
  amount              bigint      NOT NULL CHECK (amount > 0),
  -- The part that reduced what the patient still owed on the invoice.
  applied_amount      bigint      NOT NULL CHECK (applied_amount >= 0),
  -- The part already paid, credited to the patient's account at the facility.
  account_credit      bigint      NOT NULL CHECK (account_credit >= 0),
  idempotency_key     text        NOT NULL,
  issued_by           uuid        NOT NULL REFERENCES app_user (id),
  issued_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, credit_note_number),
  UNIQUE (organization_id, idempotency_key),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)  REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, invoice_id)  REFERENCES billing_invoice (organization_id, id),
  CHECK (amount = applied_amount + account_credit)
);
CREATE INDEX billing_credit_note_invoice_idx ON billing_credit_note (invoice_id);
CREATE INDEX billing_credit_note_facility_idx ON billing_credit_note (facility_id, issued_at);

CREATE TABLE billing_credit_note_line (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  credit_note_id    uuid        NOT NULL,
  invoice_item_id   uuid        NOT NULL REFERENCES billing_invoice_item (id),
  description       text        NOT NULL CHECK (length(btrim(description)) > 0),
  amount            bigint      NOT NULL CHECK (amount > 0),
  UNIQUE (credit_note_id, invoice_item_id),
  FOREIGN KEY (organization_id, credit_note_id) REFERENCES billing_credit_note (organization_id, id)
);
CREATE INDEX billing_credit_note_line_item_idx ON billing_credit_note_line (invoice_item_id);

-- Only issued invoices take credit notes, and a credit note's patient and facility are its invoice's.
CREATE FUNCTION billing_credit_note_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM billing_invoice i
    WHERE i.id = NEW.invoice_id AND i.status = 'issued' AND i.patient_id = NEW.patient_id AND i.facility_id = NEW.facility_id
  ) THEN
    RAISE EXCEPTION 'credit notes are issued against issued invoices of the same patient and facility' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER billing_credit_note_issued BEFORE INSERT ON billing_credit_note FOR EACH ROW EXECUTE FUNCTION billing_credit_note_check();

CREATE TRIGGER billing_credit_note_append_only BEFORE UPDATE OR DELETE ON billing_credit_note FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER billing_credit_note_line_append_only BEFORE UPDATE OR DELETE ON billing_credit_note_line FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- patient account (deposits and credit) ------------------------------------------------------

CREATE TABLE billing_account_entry (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL,
  facility_id        uuid        NOT NULL,
  patient_id         uuid        NOT NULL,
  -- deposit (+), credit from a credit note (+), application to an invoice (−), release of an application when its
  -- invoice is voided (+), refund to the patient (−).
  kind               text        NOT NULL CHECK (kind IN ('deposit', 'credit', 'application', 'release', 'refund')),
  amount             bigint      NOT NULL CHECK (amount > 0),
  method             text        CHECK (method IN ('cash', 'card', 'e_wallet', 'bank_transfer', 'check', 'other')),
  -- Card approval code, e-wallet or bank reference, check number.
  reference          text,
  receipt_number     text,
  invoice_id         uuid,
  credit_note_id     uuid,
  -- A release points to the application it returns.
  application_id     uuid,
  reason             text,
  idempotency_key    text,
  recorded_by        uuid        NOT NULL REFERENCES app_user (id),
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, receipt_number),
  FOREIGN KEY (organization_id, facility_id)    REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)     REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, invoice_id)     REFERENCES billing_invoice (organization_id, id),
  FOREIGN KEY (organization_id, credit_note_id) REFERENCES billing_credit_note (organization_id, id),
  FOREIGN KEY (organization_id, application_id) REFERENCES billing_account_entry (organization_id, id),
  CHECK ((kind IN ('deposit', 'refund')) = (method IS NOT NULL)),
  CHECK ((kind = 'deposit') = (receipt_number IS NOT NULL)),
  CHECK ((kind IN ('application', 'release')) = (invoice_id IS NOT NULL)),
  CHECK ((kind = 'credit') = (credit_note_id IS NOT NULL)),
  CHECK ((kind = 'release') = (application_id IS NOT NULL)),
  CHECK ((kind = 'refund') = (reason IS NOT NULL AND length(btrim(reason)) > 0)),
  -- Requests from staff carry an idempotency key; credit and release are recorded with their credit note or void.
  CHECK ((kind IN ('deposit', 'application', 'refund')) = (idempotency_key IS NOT NULL))
);
CREATE INDEX billing_account_entry_account_idx ON billing_account_entry (organization_id, patient_id, facility_id, recorded_at);
CREATE INDEX billing_account_entry_invoice_idx ON billing_account_entry (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX billing_account_entry_facility_idx ON billing_account_entry (facility_id, recorded_at);
-- An application is released at most once.
CREATE UNIQUE INDEX billing_account_entry_release_uq ON billing_account_entry (application_id) WHERE application_id IS NOT NULL;
-- One credit entry per credit note.
CREATE UNIQUE INDEX billing_account_entry_credit_uq ON billing_account_entry (credit_note_id) WHERE credit_note_id IS NOT NULL;

-- The balance never goes below zero (the service also checks, under a per-account lock).
CREATE FUNCTION billing_account_entry_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  balance bigint;
BEGIN
  IF NEW.kind IN ('application', 'refund') THEN
    SELECT coalesce(sum(CASE WHEN kind IN ('deposit', 'credit', 'release') THEN amount ELSE -amount END), 0) INTO balance
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
CREATE TRIGGER billing_account_entry_balance BEFORE INSERT ON billing_account_entry FOR EACH ROW EXECUTE FUNCTION billing_account_entry_check();

CREATE TRIGGER billing_account_entry_append_only BEFORE UPDATE OR DELETE ON billing_account_entry FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- permissions --------------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('billing.deposit.record',     'Record patient deposits and apply deposit or credit balance to invoices'),
  ('billing.credit-note.issue',  'Issue credit notes against issued invoices (with a reason)');

-- Refunds of a deposit or credit balance use billing.refund.issue (with a reason).
INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('org_admin', 'billing.deposit.record'), ('org_admin', 'billing.credit-note.issue'),
  ('cashier', 'billing.deposit.record')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system
ON CONFLICT DO NOTHING;
