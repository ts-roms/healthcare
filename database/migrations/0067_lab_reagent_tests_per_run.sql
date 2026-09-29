-- Tests per run per reagent and test (Phase 9). See docs/domains/laboratory-quality.md ("Reagent use per test run").
--
-- A run used one test of each lot in use (migration 0064). Some tests use more: run in duplicate, or with a dilution or
-- a blank. The laboratory states, for a reagent and a test, how many tests one run uses (default 1). A QC run and a
-- re-run count the tests per run of their test; the first run of an order counts once per lot (a panel is one run) with
-- the most of the ordered tests that lot serves. Runs already counted keep their count (the use record is append-only).

CREATE TABLE lab_reagent_test_usage (
  organization_id    uuid        NOT NULL REFERENCES organization (id),
  inventory_item_id  uuid        NOT NULL,
  test_id            uuid        NOT NULL,
  -- 1 is the default when no row exists; a row states more.
  tests_per_run      smallint    NOT NULL CHECK (tests_per_run BETWEEN 2 AND 100),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid        NOT NULL REFERENCES app_user (id),
  PRIMARY KEY (organization_id, inventory_item_id, test_id),
  FOREIGN KEY (organization_id, inventory_item_id) REFERENCES inventory_item (organization_id, id),
  FOREIGN KEY (organization_id, test_id)           REFERENCES lab_test (organization_id, id)
);

-- Patient and QC runs may now count more than one test (up to 100, the most a rule states).
ALTER TABLE lab_reagent_use DROP CONSTRAINT lab_reagent_use_check3;
ALTER TABLE lab_reagent_use ADD CONSTRAINT lab_reagent_use_run_tests CHECK (kind NOT IN ('patient', 'qc') OR tests <= 100);
