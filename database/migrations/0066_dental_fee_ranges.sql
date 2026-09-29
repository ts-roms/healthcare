-- Dental fee ranges. See docs/domains/dental.md ("Fee estimates").
--
-- Some procedures are only known for certain once they are under way: a simple extraction may turn out to be a
-- surgical one. The organization lists, per procedure in its catalog, the procedures it may turn out to be. A plan
-- item's estimate is then a range: from the lowest to the highest listed price among the planned procedure and those
-- (billing's prices; dentistry still keeps none). The item may be carried out as the planned procedure or one of them,
-- and billing charges what was carried out.
--
-- 1. dental_procedure_alternative: the procedures a procedure may turn out to be (same organization, a different
--    procedure, both whole-mouth or both on a tooth — checked by the service). Replaced as a whole, audited.
-- 2. The estimate recorded with a decision gains its upper bound: decision_estimate is the low end (the listed price
--    when there is no range), decision_estimate_high the high end when the item had a range. Set once, never changed.

CREATE TABLE dental_procedure_alternative (
  organization_id      uuid        NOT NULL REFERENCES organization (id),
  procedure_type_id    uuid        NOT NULL,
  alternative_type_id  uuid        NOT NULL,
  created_by           uuid        NOT NULL REFERENCES app_user (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (procedure_type_id, alternative_type_id),
  FOREIGN KEY (organization_id, procedure_type_id)   REFERENCES dental_procedure_type (organization_id, id),
  FOREIGN KEY (organization_id, alternative_type_id) REFERENCES dental_procedure_type (organization_id, id),
  CHECK (procedure_type_id <> alternative_type_id)
);

CREATE INDEX dental_procedure_alternative_org ON dental_procedure_alternative (organization_id, procedure_type_id);

ALTER TABLE dental_treatment_plan_item
  ADD COLUMN decision_estimate_high bigint,
  ADD CONSTRAINT dental_treatment_plan_item_estimate_range
    CHECK (decision_estimate_high IS NULL OR (decision_estimate IS NOT NULL AND decision_estimate_high > decision_estimate));

CREATE OR REPLACE FUNCTION dental_plan_item_estimate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.decision_estimate_on IS NOT NULL
     AND (NEW.decision_estimate, NEW.decision_estimate_high, NEW.decision_estimate_on)
         IS DISTINCT FROM (OLD.decision_estimate, OLD.decision_estimate_high, OLD.decision_estimate_on) THEN
    RAISE EXCEPTION 'the estimate recorded with a decision is not changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
