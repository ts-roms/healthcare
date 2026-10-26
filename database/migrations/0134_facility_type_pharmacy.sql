-- Facility types: add "pharmacy" (libs/organization, FACILITY_TYPES). The type is a label only; it enables no module.

ALTER TABLE facility DROP CONSTRAINT facility_facility_type_check;
ALTER TABLE facility
  ADD CONSTRAINT facility_facility_type_check CHECK (facility_type IN
    ('clinic', 'laboratory', 'dental_clinic', 'hospital', 'diagnostic_center', 'telemedicine_hub', 'pharmacy', 'other'));
