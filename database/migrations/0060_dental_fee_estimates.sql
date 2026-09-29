-- Dental fee estimates. See docs/domains/dental.md ("Fee estimates").
--
-- A treatment plan's estimate is read from billing's price list (the service mapped to each item's procedure code and
-- its price on the facility's local date), never stored as a price of dentistry's own. What is recorded here:
--
-- 1. The estimate each item carried when the patient decided it (accepted or declined, at the clinic or in MyHealth):
--    the listed price in centavos (null: no listed price then) and the date it was priced on. Set once, with the
--    decision; never changed afterwards. Items decided before this migration have no recorded estimate.
-- 2. The organization's choices: whether MyHealth shows estimates on plans (off by default; needs dental records shown)
--    and its own note printed and shown under every estimate (e.g. how long it holds). The platform supplies no
--    wording about validity, taxes or coverage beyond saying what an estimate is not.

-- ---- estimate at decision -----------------------------------------------------------------------------

ALTER TABLE dental_treatment_plan_item
  ADD COLUMN decision_estimate    bigint CHECK (decision_estimate >= 0),
  ADD COLUMN decision_estimate_on date,
  ADD CONSTRAINT dental_treatment_plan_item_estimate_dated CHECK (decision_estimate IS NULL OR decision_estimate_on IS NOT NULL),
  ADD CONSTRAINT dental_treatment_plan_item_estimate_decided CHECK (decision_estimate_on IS NULL OR status <> 'proposed');

CREATE FUNCTION dental_plan_item_estimate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.decision_estimate_on IS NOT NULL
     AND (NEW.decision_estimate, NEW.decision_estimate_on) IS DISTINCT FROM (OLD.decision_estimate, OLD.decision_estimate_on) THEN
    RAISE EXCEPTION 'the estimate recorded with a decision is not changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dental_plan_item_estimate_once BEFORE UPDATE ON dental_treatment_plan_item
  FOR EACH ROW EXECUTE FUNCTION dental_plan_item_estimate_guard();

-- ---- settings -----------------------------------------------------------------------------------------

ALTER TABLE dental_organization_setting
  ADD COLUMN portal_plan_estimates boolean NOT NULL DEFAULT false,
  ADD COLUMN fee_estimate_note     text CHECK (length(btrim(fee_estimate_note)) BETWEEN 10 AND 500),
  ADD CONSTRAINT dental_organization_setting_estimates_need_records CHECK (NOT portal_plan_estimates OR portal_dental_records);
