-- Procedures performed at the clinic (docs/domains/clinic.md, "Procedures"): wound dressing, suturing, incision and
-- drainage, nebulization, injections given in a consultation and the like — anything but dental work (libs/dental) and
-- immunizations (0081), which have their own records.
--
-- The organization keeps its own procedure catalogue (a code of its own, a name, optional code of a code system it
-- names). No national procedure code set, relative value scale or PhilHealth procedure code is assumed: those are
-- the organization's configuration (a code system key) and, for claims, integration dependencies.
--
-- A procedure is recorded in an in-person consultation of the same patient at the same facility; once the
-- consultation is signed, only someone who may amend it records one, with a reason (a late entry). It names the
-- practitioner who performed it. Records are immutable except being marked entered in error (once, with a reason);
-- nothing is deleted. Billing charges the procedure's code through a service mapped to it (charge source
-- 'clinic_procedure', quantity as recorded) and cancels a charge not yet invoiced when the procedure is in error.

-- ---- the organization's procedure catalogue ----------------------------------------------------------------

CREATE TABLE clinic_procedure_definition (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  -- The organization's own code (billing maps a service to it).
  code             text        NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$'),
  name             text        NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 200),
  -- A code of a code system the organization names (e.g. its RVS edition as a key); exported when configured.
  code_system      text        CHECK (code_system ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  external_code    text        CHECK (length(btrim(external_code)) BETWEEN 1 AND 40),
  -- Ask for the body site when recording (e.g. a laceration repair).
  requires_body_site boolean   NOT NULL DEFAULT false,
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid        NOT NULL REFERENCES app_user (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  CHECK ((external_code IS NULL) = (code_system IS NULL))
);
-- A code is the organization's for good (billing and records refer to it), whatever the entry's status.
CREATE UNIQUE INDEX clinic_procedure_definition_code ON clinic_procedure_definition (organization_id, upper(code));
CREATE UNIQUE INDEX clinic_procedure_definition_active_name ON clinic_procedure_definition (organization_id, lower(btrim(name))) WHERE status = 'active';

-- ---- procedures performed ----------------------------------------------------------------------------------

CREATE TABLE clinic_procedure (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            uuid        NOT NULL,
  patient_id                 uuid        NOT NULL,
  facility_id                uuid        NOT NULL,
  encounter_id               uuid        NOT NULL,
  definition_id              uuid        NOT NULL,
  -- The catalogue entry as it was when recorded.
  code                       text        NOT NULL,
  name                       text        NOT NULL,
  code_system                text,
  external_code              text,
  performed_at               timestamptz NOT NULL,
  performer_practitioner_id  uuid        NOT NULL,
  -- As written (e.g. "left forearm").
  body_site                  text        CHECK (length(btrim(body_site)) BETWEEN 1 AND 120),
  -- How many were done (e.g. two lesions excised); the quantity billed.
  quantity                   smallint    NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99),
  -- The clinician's own words (staff only).
  notes                      text        CHECK (length(btrim(notes)) BETWEEN 1 AND 2000),
  -- Recorded after the consultation was signed: why (with encounter.amend).
  late_entry_reason          text        CHECK (length(btrim(late_entry_reason)) BETWEEN 3 AND 500),
  entered_in_error_reason    text        CHECK (length(btrim(entered_in_error_reason)) BETWEEN 3 AND 500),
  entered_in_error_by        uuid        REFERENCES app_user (id),
  entered_in_error_at        timestamptz,
  recorded_by                uuid        NOT NULL REFERENCES app_user (id),
  recorded_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)                REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, facility_id)               REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, encounter_id)              REFERENCES encounter (organization_id, id),
  FOREIGN KEY (patient_id, encounter_id)                   REFERENCES encounter (patient_id, id),
  FOREIGN KEY (organization_id, definition_id)             REFERENCES clinic_procedure_definition (organization_id, id),
  FOREIGN KEY (organization_id, performer_practitioner_id) REFERENCES practitioner (organization_id, id),
  CHECK ((external_code IS NULL) = (code_system IS NULL)),
  CHECK ((entered_in_error_at IS NULL) = (entered_in_error_by IS NULL) AND (entered_in_error_at IS NULL) = (entered_in_error_reason IS NULL))
);
CREATE INDEX clinic_procedure_patient_idx ON clinic_procedure (organization_id, patient_id, performed_at DESC);
CREATE INDEX clinic_procedure_encounter_idx ON clinic_procedure (encounter_id);

-- Immutable except being marked entered in error, once; never deleted.
CREATE FUNCTION clinic_procedure_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable constant text[] := ARRAY['entered_in_error_reason', 'entered_in_error_by', 'entered_in_error_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clinic_procedure rows are never deleted; mark them entered in error' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) OR OLD.entered_in_error_at IS NOT NULL THEN
    RAISE EXCEPTION 'clinic_procedure: only marking entered in error, once, is permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER clinic_procedure_guard BEFORE UPDATE OR DELETE ON clinic_procedure FOR EACH ROW EXECUTE FUNCTION clinic_procedure_guard();
CREATE TRIGGER clinic_procedure_no_truncate BEFORE TRUNCATE ON clinic_procedure FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();
-- No new care filed under a merged record (ADR-0009, migration 0068).
CREATE TRIGGER clinic_procedure_not_for_merged_patient BEFORE INSERT ON clinic_procedure
  FOR EACH ROW EXECUTE FUNCTION refuse_record_for_merged_patient();

-- ---- billing: a service may be mapped to a clinic procedure; charges may come from one -------------------------

ALTER TABLE billing_service DROP CONSTRAINT billing_service_source_kind_check;
ALTER TABLE billing_service ADD CONSTRAINT billing_service_source_kind_check
  CHECK (source_kind IN ('visit_type', 'lab_test', 'dental_procedure', 'clinic_procedure'));
ALTER TABLE billing_charge DROP CONSTRAINT billing_charge_source_type_check;
ALTER TABLE billing_charge ADD CONSTRAINT billing_charge_source_type_check
  CHECK (source_type IN ('encounter', 'lab_order_item', 'dental_procedure', 'clinic_procedure', 'manual', 'package'));
