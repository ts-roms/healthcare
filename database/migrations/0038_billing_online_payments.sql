-- Billing follow-ups: online payment through a payment provider. See docs/domains/billing.md.
--
-- No payment provider has been chosen: the provider is a port with an unconfigured default adapter, so no payment
-- can be started until an adapter exists (an integration dependency, like PhilHealth eClaims). A patient starts a
-- payment of an issued invoice in MyHealth (a payment intent); the provider's checkout takes the money; the
-- provider's verified notification completes the intent, which records the payment in the ledger (and any amount
-- beyond the balance — the invoice was paid at the counter in the meantime — as a deposit on the patient's account).
-- Card data never reaches the platform.

CREATE TABLE billing_payment_intent (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL,
  facility_id         uuid        NOT NULL,
  invoice_id          uuid        NOT NULL,
  patient_id          uuid        NOT NULL,
  amount              bigint      NOT NULL CHECK (amount > 0),
  status              text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled', 'expired')),
  -- The adapter's name and its reference for the checkout (set once the checkout is created).
  provider            text        NOT NULL CHECK (provider ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  provider_reference  text,
  checkout_url        text,
  requested_via       text        NOT NULL CHECK (requested_via IN ('portal')),
  idempotency_key     text        NOT NULL,
  -- What the provider collected, and where it went.
  paid_amount         bigint      CHECK (paid_amount > 0),
  failure_code        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (provider, provider_reference),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)  REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, invoice_id)  REFERENCES billing_invoice (organization_id, id),
  CHECK ((status = 'pending') = (completed_at IS NULL)),
  CHECK ((status = 'succeeded') = (paid_amount IS NOT NULL))
);
CREATE INDEX billing_payment_intent_invoice_idx ON billing_payment_intent (invoice_id);

-- A completed intent does not change; a pending one gets its checkout reference, then completes once.
CREATE FUNCTION billing_payment_intent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'payment intents are not deleted' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status <> 'pending' THEN RAISE EXCEPTION 'a completed payment intent cannot change' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.amount <> OLD.amount OR NEW.invoice_id <> OLD.invoice_id OR NEW.patient_id <> OLD.patient_id OR NEW.provider <> OLD.provider
     OR (OLD.provider_reference IS NOT NULL AND NEW.provider_reference IS DISTINCT FROM OLD.provider_reference) THEN
    RAISE EXCEPTION 'a payment intent keeps its invoice, amount and provider reference' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER billing_payment_intent_immutable BEFORE UPDATE OR DELETE ON billing_payment_intent FOR EACH ROW EXECUTE FUNCTION billing_payment_intent_guard();

-- Payments and deposits recorded from a completed online payment have no staff user; they point to the intent.
ALTER TABLE billing_payment ALTER COLUMN recorded_by DROP NOT NULL;
ALTER TABLE billing_payment ADD COLUMN payment_intent_id uuid;
ALTER TABLE billing_payment ADD FOREIGN KEY (organization_id, payment_intent_id) REFERENCES billing_payment_intent (organization_id, id);
ALTER TABLE billing_payment ADD CONSTRAINT billing_payment_recorded_check CHECK (recorded_by IS NOT NULL OR payment_intent_id IS NOT NULL);

ALTER TABLE billing_account_entry ALTER COLUMN recorded_by DROP NOT NULL;
ALTER TABLE billing_account_entry ADD COLUMN payment_intent_id uuid;
ALTER TABLE billing_account_entry ADD FOREIGN KEY (organization_id, payment_intent_id) REFERENCES billing_payment_intent (organization_id, id);
ALTER TABLE billing_account_entry ADD CONSTRAINT billing_account_entry_recorded_check CHECK (recorded_by IS NOT NULL OR payment_intent_id IS NOT NULL);
