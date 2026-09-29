-- Low reagent alert (Phase 9). See docs/domains/laboratory-quality.md ("Reagent use").
--
-- When the runs counted against a loaded reagent lot leave a tenth of its capacity or less, the laboratory raises one
-- alert for that load: recorded here (once per load, database-enforced) with what was left at that moment, and
-- published as LaboratoryReagentLow, which tells the facility's quality managers in the app. A load without a
-- capacity never raises one. Append-only.

CREATE TABLE lab_reagent_low_alert (
  reagent_load_id  uuid        PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  facility_id      uuid        NOT NULL,
  capacity_tests   integer     NOT NULL CHECK (capacity_tests > 0),
  -- Tests left when the alert was raised (negative: used beyond the stated capacity).
  remaining_tests  integer     NOT NULL CHECK (remaining_tests <= capacity_tests),
  raised_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, facility_id)     REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, reagent_load_id) REFERENCES lab_reagent_load (organization_id, id)
);

CREATE INDEX lab_reagent_low_alert_facility ON lab_reagent_low_alert (organization_id, facility_id, raised_at);

CREATE TRIGGER lab_reagent_low_alert_append_only BEFORE UPDATE OR DELETE ON lab_reagent_low_alert
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
