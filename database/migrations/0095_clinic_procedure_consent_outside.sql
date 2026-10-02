-- Clinic procedures (0085, 0089): consent recorded against a procedure, a note template per catalogue entry, and
-- procedures performed outside a consultation. See docs/domains/clinic.md ("Procedures").
--
-- 1. Consent. The organization writes its own consent wording per catalogue entry (versioned, append-only; the
--    platform ships none) and may require consent before a procedure of that entry is recorded. The consent is recorded
--    against the procedure (one per procedure): how it was captured (paper, electronic, verbal), by the patient or a
--    representative named as written, who obtained it, when, the wording version the patient was shown, an optional
--    scan of the signed form (a `consent_form` document of the same patient) and notes. The content of a valid informed
--    consent and who may consent for a minor or an incapacitated patient are the organization's compliance decisions
--    (docs/security/compliance-dependencies.md); nothing here decides them.
-- 2. Note template: text of the organization's own that prefills the procedure notes; the stored note is what the
--    clinician submitted. No placeholders, no clinical rule.
-- 3. Outside a consultation: a procedure may be filed under a queue visit instead of a consultation (never free-floating)
--    when the catalogue entry allows it (`allowed_outside_consultation`, off by default: which procedures a nurse may
--    carry out without a physician's consultation is the organization's own clinical governance). New permission
--    `procedure.record` (org_admin, physician, nurse) records on a visit; recording in a consultation stays on
--    `encounter.write`.

-- ---- catalogue -------------------------------------------------------------------------------------------------

ALTER TABLE clinic_procedure_definition
  ADD COLUMN consent_required            boolean NOT NULL DEFAULT false,
  ADD COLUMN allowed_outside_consultation boolean NOT NULL DEFAULT false,
  ADD COLUMN note_template               text    CHECK (length(btrim(note_template)) BETWEEN 1 AND 2000);

-- The organization's consent wording for a catalogue entry, version by version (append-only).
CREATE TABLE clinic_procedure_consent_wording (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  definition_id    uuid        NOT NULL,
  version          integer     NOT NULL CHECK (version > 0),
  title            text        NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
  body             text        NOT NULL CHECK (length(btrim(body)) BETWEEN 20 AND 8000),
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, definition_id, version),
  FOREIGN KEY (organization_id, definition_id) REFERENCES clinic_procedure_definition (organization_id, id)
);
CREATE TRIGGER clinic_procedure_consent_wording_append_only BEFORE UPDATE OR DELETE ON clinic_procedure_consent_wording
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- procedures outside a consultation -------------------------------------------------------------------------

ALTER TABLE clinic_procedure
  ALTER COLUMN encounter_id DROP NOT NULL,
  ADD COLUMN visit_id uuid,
  ADD FOREIGN KEY (organization_id, visit_id) REFERENCES visit (organization_id, id),
  ADD FOREIGN KEY (patient_id, visit_id)      REFERENCES visit (patient_id, id),
  -- Filed under a consultation or under a queue visit, never free-floating.
  ADD CONSTRAINT clinic_procedure_filed_under CHECK (encounter_id IS NOT NULL OR visit_id IS NOT NULL);
CREATE INDEX clinic_procedure_visit_idx ON clinic_procedure (visit_id) WHERE visit_id IS NOT NULL;

-- ---- consent recorded against a procedure ---------------------------------------------------------------------

CREATE TABLE clinic_procedure_consent (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid        NOT NULL,
  patient_id                uuid        NOT NULL,
  procedure_id              uuid        NOT NULL,
  -- The wording the patient was shown (null for consent on paper or in words without a published wording).
  wording_id                uuid,
  wording_version           integer     CHECK (wording_version > 0),
  captured_via              text        NOT NULL CHECK (captured_via IN ('paper', 'electronic', 'verbal')),
  given_by                  text        NOT NULL CHECK (given_by IN ('patient', 'representative')),
  -- The representative as written (a parent, guardian or relative); who may consent for whom is not decided here.
  representative_name       text        CHECK (length(btrim(representative_name)) BETWEEN 2 AND 200),
  representative_relationship text      CHECK (length(btrim(representative_relationship)) BETWEEN 2 AND 100),
  obtained_by_practitioner_id uuid      NOT NULL,
  obtained_at               timestamptz NOT NULL,
  -- A scan of the signed form: a `consent_form` document of the same patient.
  document_id               uuid,
  notes                     text        CHECK (length(btrim(notes)) BETWEEN 1 AND 1000),
  recorded_by               uuid        NOT NULL REFERENCES app_user (id),
  recorded_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (procedure_id),
  FOREIGN KEY (organization_id, patient_id)                  REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, procedure_id)                REFERENCES clinic_procedure (organization_id, id),
  FOREIGN KEY (organization_id, wording_id)                  REFERENCES clinic_procedure_consent_wording (organization_id, id),
  FOREIGN KEY (organization_id, obtained_by_practitioner_id) REFERENCES practitioner (organization_id, id),
  FOREIGN KEY (organization_id, patient_id, document_id)     REFERENCES document (organization_id, patient_id, id),
  CHECK ((wording_id IS NULL) = (wording_version IS NULL)),
  CHECK (given_by = 'patient' OR representative_name IS NOT NULL),
  CHECK (given_by = 'representative' OR (representative_name IS NULL AND representative_relationship IS NULL))
);
CREATE TRIGGER clinic_procedure_consent_append_only BEFORE UPDATE OR DELETE ON clinic_procedure_consent
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- permission ------------------------------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('procedure.record', 'Record a procedure performed outside a consultation, under a queue visit (catalogue entries the organization allows)');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('org_admin', 'procedure.record'),
  ('physician', 'procedure.record'),
  ('nurse', 'procedure.record')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system
ON CONFLICT DO NOTHING;
