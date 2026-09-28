-- PhilHealth YAKAP: adapter stubs (Phase 8). See docs/interoperability/philhealth-yakap.md.
--
-- No official YAKAP specification is on record: nothing here models PhilHealth's registration or encounter formats,
-- benefit package contents, first-patient-encounter requirements, capitation, eligibility rules, deadlines or code
-- lists. What the platform keeps is its own side of the workflow:
--   * each facility's YAKAP participation reference as issued by PhilHealth (recorded by staff, not verified);
--   * the patient's YAKAP registration status as PhilHealth's own channel answered it (append-only history).
-- Encounter packages are prepared on demand from the clinical record and, once an adapter exists, sent through
-- integration_exchange (0021): no table of their own.

CREATE TABLE philhealth_yakap_participation (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL REFERENCES organization (id),
  facility_id              uuid        NOT NULL,
  -- As issued by PhilHealth; its format is not known, so it is kept as text.
  participation_reference  text        NOT NULL CHECK (length(btrim(participation_reference)) BETWEEN 1 AND 60),
  valid_from               date,
  valid_until              date,
  updated_by               uuid        NOT NULL REFERENCES app_user (id),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  integer     NOT NULL DEFAULT 1,
  UNIQUE (facility_id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);

-- PhilHealth's answer about a patient's YAKAP registration with a facility, in the platform's own neutral vocabulary.
-- The platform never decides registration: 'unknown' is what staff record when PhilHealth's channel gave no clear answer.
CREATE TABLE philhealth_yakap_registration (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL REFERENCES organization (id),
  facility_id         uuid        NOT NULL,
  patient_id          uuid        NOT NULL,
  status              text        NOT NULL CHECK (status IN ('registered', 'not_registered', 'pending', 'unknown')),
  -- The effective date PhilHealth gave, if any.
  effective_date      date,
  -- The reference PhilHealth's channel gave (required unless the answer is 'unknown').
  external_reference  text        CHECK (length(btrim(external_reference)) BETWEEN 1 AND 80),
  note                text        CHECK (length(note) <= 500),
  recorded_by         uuid        NOT NULL REFERENCES app_user (id),
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)  REFERENCES patient (organization_id, id),
  CHECK (status = 'unknown' OR external_reference IS NOT NULL)
);
CREATE INDEX philhealth_yakap_registration_patient ON philhealth_yakap_registration (organization_id, patient_id, recorded_at DESC);

-- Recorded answers are history: never changed, never deleted. A newer answer is a new row.
CREATE FUNCTION philhealth_yakap_registration_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'YAKAP registration answers are not deleted' USING ERRCODE = 'check_violation'; END IF;
  RAISE EXCEPTION 'a recorded YAKAP registration answer cannot change' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER philhealth_yakap_registration_immutable BEFORE UPDATE OR DELETE ON philhealth_yakap_registration
  FOR EACH ROW EXECUTE FUNCTION philhealth_yakap_registration_guard();

-- No new permissions: philhealth.settings.manage (participation reference), philhealth.eligibility.manage
-- (registration answers) and philhealth.claim.submit (encounter packages) cover the workflow.
