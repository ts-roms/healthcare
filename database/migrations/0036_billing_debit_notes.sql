-- Billing follow-ups: debit notes, and credit notes that credit payer coverage. See docs/domains/billing.md.
--
-- A debit note adds to what the patient owes on an issued invoice (a service given or charged too low after the
-- invoice was issued), with a reason and its own configurable number series. Immutable, like credit notes.
-- A credit note may now also credit what a payer (HMO, PhilHealth, insurer) is expected to cover on an issued
-- invoice, while that coverage is not yet settled or denied; and it may credit lines of a debit note.
--
-- Compliance dependency: whether debit and credit notes meet BIR requirements (format, numbering, VAT adjustment)
-- must be verified; prefixes and series are configuration.

ALTER TABLE billing_sequence DROP CONSTRAINT billing_sequence_kind_check;
ALTER TABLE billing_sequence ADD CONSTRAINT billing_sequence_kind_check CHECK (kind IN ('invoice', 'receipt', 'credit_note', 'debit_note'));

-- ---- debit notes --------------------------------------------------------------------------------

CREATE TABLE billing_debit_note (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL,
  facility_id         uuid        NOT NULL,
  patient_id          uuid        NOT NULL,
  invoice_id          uuid        NOT NULL,
  debit_note_number   text        NOT NULL,
  reason              text        NOT NULL CHECK (length(btrim(reason)) >= 3),
  amount              bigint      NOT NULL CHECK (amount > 0),
  idempotency_key     text        NOT NULL,
  issued_by           uuid        NOT NULL REFERENCES app_user (id),
  issued_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, debit_note_number),
  UNIQUE (organization_id, idempotency_key),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)  REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, invoice_id)  REFERENCES billing_invoice (organization_id, id)
);
CREATE INDEX billing_debit_note_invoice_idx ON billing_debit_note (invoice_id);
CREATE INDEX billing_debit_note_facility_idx ON billing_debit_note (facility_id, issued_at);

CREATE TABLE billing_debit_note_line (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  debit_note_id     uuid        NOT NULL,
  -- The billable service, when the line is one (null for an adjustment described in words).
  service_id        uuid,
  description       text        NOT NULL CHECK (length(btrim(description)) > 0),
  quantity          integer     NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  unit_price        bigint      NOT NULL CHECK (unit_price > 0),
  amount            bigint      NOT NULL CHECK (amount = unit_price * quantity),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, debit_note_id) REFERENCES billing_debit_note (organization_id, id),
  FOREIGN KEY (organization_id, service_id)    REFERENCES billing_service (organization_id, id)
);
CREATE INDEX billing_debit_note_line_note_idx ON billing_debit_note_line (debit_note_id);

CREATE FUNCTION billing_debit_note_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM billing_invoice i
    WHERE i.id = NEW.invoice_id AND i.status = 'issued' AND i.patient_id = NEW.patient_id AND i.facility_id = NEW.facility_id
  ) THEN
    RAISE EXCEPTION 'debit notes are issued against issued invoices of the same patient and facility' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER billing_debit_note_issued BEFORE INSERT ON billing_debit_note FOR EACH ROW EXECUTE FUNCTION billing_debit_note_check();
CREATE TRIGGER billing_debit_note_append_only BEFORE UPDATE OR DELETE ON billing_debit_note FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER billing_debit_note_line_append_only BEFORE UPDATE OR DELETE ON billing_debit_note_line FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- credit notes: payer coverage and debit note lines ---------------------------------------------

-- The part of a credit note that reduces what payers are expected to cover.
ALTER TABLE billing_credit_note ADD COLUMN payer_amount bigint NOT NULL DEFAULT 0 CHECK (payer_amount >= 0);
ALTER TABLE billing_credit_note DROP CONSTRAINT billing_credit_note_check;
ALTER TABLE billing_credit_note ADD CONSTRAINT billing_credit_note_check CHECK (amount = applied_amount + account_credit + payer_amount);

CREATE TABLE billing_credit_note_payer (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  credit_note_id    uuid        NOT NULL,
  invoice_payer_id  uuid        NOT NULL REFERENCES billing_invoice_payer (id),
  amount            bigint      NOT NULL CHECK (amount > 0),
  UNIQUE (credit_note_id, invoice_payer_id),
  FOREIGN KEY (organization_id, credit_note_id) REFERENCES billing_credit_note (organization_id, id)
);
CREATE INDEX billing_credit_note_payer_coverage_idx ON billing_credit_note_payer (invoice_payer_id);
CREATE TRIGGER billing_credit_note_payer_append_only BEFORE UPDATE OR DELETE ON billing_credit_note_payer FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- A credit line credits a line of the invoice or a line of one of its debit notes.
ALTER TABLE billing_credit_note_line ALTER COLUMN invoice_item_id DROP NOT NULL;
ALTER TABLE billing_credit_note_line ADD COLUMN debit_note_line_id uuid REFERENCES billing_debit_note_line (id);
ALTER TABLE billing_credit_note_line ADD CONSTRAINT billing_credit_note_line_target_check
  CHECK ((invoice_item_id IS NULL) <> (debit_note_line_id IS NULL));
CREATE UNIQUE INDEX billing_credit_note_line_debit_uq ON billing_credit_note_line (credit_note_id, debit_note_line_id) WHERE debit_note_line_id IS NOT NULL;

-- ---- permissions --------------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('billing.debit-note.issue', 'Issue debit notes against issued invoices (with a reason)');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'billing.debit-note.issue' FROM role r WHERE r.key = 'org_admin' AND r.is_system
ON CONFLICT DO NOTHING;
