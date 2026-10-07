-- Vital signs: when a set was marked entered in error (docs/interoperability/fhir.md, "_lastUpdated").
--
-- A vital-sign set changes only once after it is recorded — when it is marked entered in error — but that change had
-- no time of its own, so the FHIR Observation could not carry a reliable meta.lastUpdated and `_lastUpdated` was
-- refused for Observation as a whole. The time is kept from now on; sets marked in error before this migration are
-- given their recorded time, so no row is left without one.

ALTER TABLE vital_sign_set ADD COLUMN entered_in_error_at timestamptz;
UPDATE vital_sign_set SET entered_in_error_at = recorded_at WHERE status = 'entered_in_error';
ALTER TABLE vital_sign_set ADD CONSTRAINT vital_sign_set_entered_in_error_at CHECK ((status = 'entered_in_error') = (entered_in_error_at IS NOT NULL));
