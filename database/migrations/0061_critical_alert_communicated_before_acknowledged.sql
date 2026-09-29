-- A critical result is acknowledged by the ordering side only after the laboratory documented telling them
-- (open → communicated → acknowledged; docs/domains/laboratory.md). The service refuses it (alert_not_communicated);
-- the constraint keeps the rule for any writer. NOT VALID: alerts acknowledged before this rule are kept as recorded.

ALTER TABLE lab_critical_alert
  ADD CONSTRAINT lab_critical_alert_communicated_before_acknowledged
  CHECK (status <> 'acknowledged' OR communicated_at IS NOT NULL) NOT VALID;
