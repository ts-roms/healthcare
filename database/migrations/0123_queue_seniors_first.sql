-- Optional queue lane for seniors (a facility's own choice; off by default so no queue changes order on its own).
-- When on, a routine visit of a patient at or above the senior age is listed before other routine visits (arrival
-- order within each group); urgent and emergency visits always stay ahead.
ALTER TABLE service_point_setting
  ADD COLUMN seniors_first boolean NOT NULL DEFAULT false;
