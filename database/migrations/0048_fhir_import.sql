-- FHIR R4 inbound: imports into a review queue, never straight into the record (Phase 8). See docs/interoperability/fhir.md.
--
-- A sender submits a Bundle (collection, document, searchset) or a single resource. The received content is PHI from
-- outside: it is kept only sealed with the integration payload key ring ("v2.<key id>.…", AES-256-GCM, as
-- integration_exchange_payload), never as plaintext. In clear: non-PHI metadata only (resource types and counts, the
-- SHA-256 digest of the content and of the idempotency key, the declared source system URI, review outcomes).
--
-- Staff match the patient (nothing is linked automatically) and accept or reject each entry with a reason. Accepting
-- writes through the owning domain: an AllergyIntolerance becomes an allergy (source external_import, unconfirmed);
-- a Condition, Observation, MedicationStatement/MedicationRequest or DocumentReference becomes a clearly labelled
-- external history entry — never an encounter, diagnosis, vital sign, laboratory result or prescription.
--
-- Retention: the sealed content of a rejected import is deleted 30 days after the rejection (FhirImportRetention);
-- the import row, its entries and outcomes stay as the audit of what was received and decided.

CREATE TABLE fhir_import (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid        NOT NULL REFERENCES organization (id),
  -- SHA-256 of the caller's Idempotency-Key, or of "bundle-identifier:<system>|<value>" (keys may carry identifiers).
  idempotency_key_digest  text        NOT NULL CHECK (idempotency_key_digest ~ '^[0-9a-f]{64}$'),
  content_digest          text        NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  source_kind             text        NOT NULL CHECK (source_kind IN ('bundle', 'resource')),
  bundle_type             text        CHECK (bundle_type IN ('collection', 'document', 'searchset')),
  -- The sending system as declared (Bundle.meta.source, a URI); not verified.
  declared_source         text        CHECK (length(declared_source) BETWEEN 1 AND 200 AND declared_source !~ '\s'),
  resource_counts         jsonb       NOT NULL CHECK (jsonb_typeof(resource_counts) = 'object'),
  entry_count             integer     NOT NULL CHECK (entry_count BETWEEN 1 AND 100),
  status                  text        NOT NULL DEFAULT 'pending_review'
                                      CHECK (status IN ('pending_review', 'accepted', 'partially_accepted', 'rejected')),
  patient_id              uuid,
  matched_by              uuid        REFERENCES app_user (id),
  matched_at              timestamptz,
  rejection_reason        text        CHECK (length(btrim(rejection_reason)) BETWEEN 3 AND 500),
  received_by             uuid        NOT NULL REFERENCES app_user (id),
  received_at             timestamptz NOT NULL DEFAULT now(),
  completed_by            uuid        REFERENCES app_user (id),
  completed_at            timestamptz,
  content_purged_at       timestamptz,
  version                 integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, idempotency_key_digest),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id),
  CHECK ((source_kind = 'bundle') = (bundle_type IS NOT NULL)),
  CHECK ((patient_id IS NULL) = (matched_at IS NULL) AND (matched_at IS NULL) = (matched_by IS NULL)),
  CHECK ((status = 'pending_review') = (completed_at IS NULL) AND (completed_at IS NULL) = (completed_by IS NULL)),
  CHECK (content_purged_at IS NULL OR status = 'rejected')
);
CREATE INDEX fhir_import_review_idx ON fhir_import (organization_id, received_at DESC) WHERE status = 'pending_review';
CREATE INDEX fhir_import_received_idx ON fhir_import (organization_id, received_at DESC);
CREATE INDEX fhir_import_purge_idx ON fhir_import (completed_at) WHERE status = 'rejected' AND content_purged_at IS NULL;

-- The received content, sealed. Deleted by the retention rule for rejected imports; never updated.
CREATE TABLE fhir_import_content (
  import_id        uuid        PRIMARY KEY,
  organization_id  uuid        NOT NULL,
  key_id           text        NOT NULL CHECK (key_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  ciphertext       text        NOT NULL CHECK (ciphertext LIKE 'v2.%' AND split_part(ciphertext, '.', 2) = key_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, import_id) REFERENCES fhir_import (organization_id, id)
);
CREATE TRIGGER fhir_import_content_no_update BEFORE UPDATE ON fhir_import_content
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- One row per received entry: its resource type and the review outcome (the content itself stays sealed).
CREATE TABLE fhir_import_entry (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  import_id        uuid        NOT NULL,
  entry_index      integer     NOT NULL CHECK (entry_index >= 0),
  resource_type    text        NOT NULL CHECK (resource_type ~ '^[A-Z][A-Za-z]{1,63}$'),
  kind             text        NOT NULL CHECK (kind IN ('patient', 'allergy', 'condition', 'observation', 'medication', 'document', 'not_supported')),
  outcome          text        NOT NULL CHECK (outcome IN ('pending', 'accepted', 'rejected', 'not_supported')),
  reason           text        CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  -- What accepting created: allergy_intolerance, external_history_entry, or the matched patient.
  result_type      text        CHECK (result_type IN ('allergy_intolerance', 'external_history_entry', 'patient')),
  result_id        uuid,
  decided_by       uuid        REFERENCES app_user (id),
  decided_at       timestamptz,
  UNIQUE (import_id, entry_index),
  FOREIGN KEY (organization_id, import_id) REFERENCES fhir_import (organization_id, id),
  CHECK ((kind = 'not_supported') = (outcome = 'not_supported')),
  CHECK ((outcome IN ('pending', 'not_supported')) = (decided_at IS NULL) AND (decided_at IS NULL) = (decided_by IS NULL)),
  CHECK ((outcome = 'rejected') = (reason IS NOT NULL)),
  CHECK ((outcome = 'accepted') = (result_type IS NOT NULL) AND (result_type IS NULL) = (result_id IS NULL))
);
CREATE INDEX fhir_import_entry_import_idx ON fhir_import_entry (import_id, entry_index);

-- ---- clinic: where accepted entries go ------------------------------------------------------------------------

-- Allergies record where they came from. Staff entries are 'staff'; an accepted import is 'external_import' with the
-- import reference ("fhir-import:<import id>#<entry index>") and the declared source.
ALTER TABLE allergy_intolerance
  ADD COLUMN source            text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'external_import')),
  ADD COLUMN source_reference  text CHECK (length(source_reference) BETWEEN 1 AND 300),
  ADD CONSTRAINT allergy_intolerance_source_reference CHECK ((source = 'external_import') = (source_reference IS NOT NULL));

-- External clinical history: what another provider recorded (conditions, observations, medications, document
-- descriptions), accepted by staff from an import. Shown as external history — it is not an internal diagnosis,
-- vital sign, laboratory result or prescription, and no clinical logic treats it as one. Append-only except that an
-- active entry may be marked entered in error (with a reason).
CREATE TABLE external_history_entry (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL,
  patient_id               uuid        NOT NULL,
  kind                     text        NOT NULL CHECK (kind IN ('condition', 'observation', 'medication', 'document')),
  category                 text        CHECK (length(category) BETWEEN 1 AND 200),
  display                  text        NOT NULL CHECK (length(btrim(display)) BETWEEN 1 AND 500),
  code_system              text        CHECK (length(code_system) BETWEEN 1 AND 200),
  code                     text        CHECK (length(code) BETWEEN 1 AND 60),
  value_text               text        CHECK (length(value_text) BETWEEN 1 AND 500),
  status_text              text        CHECK (length(status_text) BETWEEN 1 AND 120),
  effective_text           text        CHECK (length(effective_text) BETWEEN 1 AND 60),
  source                   text        NOT NULL DEFAULT 'external_import' CHECK (source = 'external_import'),
  source_reference         text        NOT NULL CHECK (length(source_reference) BETWEEN 1 AND 300),
  declared_source          text        CHECK (length(declared_source) BETWEEN 1 AND 200),
  status                   text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'entered_in_error')),
  entered_in_error_reason  text,
  entered_in_error_by      uuid        REFERENCES app_user (id),
  entered_in_error_at      timestamptz,
  recorded_by              uuid        NOT NULL REFERENCES app_user (id),
  recorded_at              timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id),
  CHECK ((status = 'entered_in_error') = (entered_in_error_at IS NOT NULL)
         AND (entered_in_error_at IS NULL) = (entered_in_error_by IS NULL)
         AND (entered_in_error_at IS NULL) = (entered_in_error_reason IS NULL)),
  CHECK (entered_in_error_reason IS NULL OR length(btrim(entered_in_error_reason)) BETWEEN 3 AND 500)
);
CREATE INDEX external_history_entry_patient_idx ON external_history_entry (organization_id, patient_id, recorded_at DESC);

CREATE FUNCTION external_history_entry_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'external_history_entry is append-only; DELETE is not permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'active' OR NEW.status <> 'entered_in_error'
     OR (NEW.id, NEW.organization_id, NEW.patient_id, NEW.kind, NEW.category, NEW.display, NEW.code_system, NEW.code,
         NEW.value_text, NEW.status_text, NEW.effective_text, NEW.source, NEW.source_reference, NEW.declared_source,
         NEW.recorded_by, NEW.recorded_at)
        IS DISTINCT FROM
        (OLD.id, OLD.organization_id, OLD.patient_id, OLD.kind, OLD.category, OLD.display, OLD.code_system, OLD.code,
         OLD.value_text, OLD.status_text, OLD.effective_text, OLD.source, OLD.source_reference, OLD.declared_source,
         OLD.recorded_by, OLD.recorded_at) THEN
    RAISE EXCEPTION 'external_history_entry: only marking an active entry entered in error is permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER external_history_entry_guard BEFORE UPDATE OR DELETE ON external_history_entry
  FOR EACH ROW EXECUTE FUNCTION external_history_entry_guard();

-- ---- permissions ---------------------------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('interop.fhir.import', 'Submit FHIR R4 content for import (received into the review queue, never into the record; audited)'),
  ('interop.fhir.import.review', 'Review FHIR imports: view received content, match the patient, accept or reject entries (audited)');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, p.key FROM role r
CROSS JOIN (VALUES ('interop.fhir.import'), ('interop.fhir.import.review')) AS p (key)
WHERE r.key = 'org_admin' AND r.is_system
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'interop.fhir.import.review' FROM role r
WHERE r.key = 'records_officer' AND r.is_system
ON CONFLICT DO NOTHING;
