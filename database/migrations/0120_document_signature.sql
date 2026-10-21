-- Electronic signatures, phase 1 (docs/architecture/electronic-signatures.md).
--
-- A signature is evidence bound to one stored document: who signed, how they were identified, when, what the signer
-- was shown (the hash of the form before the mark was added) and the strokes drawn. Append-only; nothing here decides
-- whether a drawn signature is legally valid for a given document (a compliance dependency of the organization).

CREATE TABLE document_signature (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL REFERENCES organization (id),
  patient_id          uuid        NOT NULL,
  -- The stored, signed document (the PDF carrying the mark).
  document_id         uuid        NOT NULL,
  -- SHA-256 (hex) of the text the signer agreed to (wording id, version, title, text, patient number, procedure code),
  -- recomputable from the records; the signed PDF is hashed in document.sha256.
  shown_sha256        text        NOT NULL CHECK (shown_sha256 ~ '^[0-9a-f]{64}$'),
  signer_kind         text        NOT NULL CHECK (signer_kind IN ('patient', 'representative')),
  signer_name         text        NOT NULL CHECK (length(btrim(signer_name)) BETWEEN 2 AND 200),
  -- The representative's relationship as written; who may sign for whom is not decided here.
  signer_relationship text        CHECK (length(btrim(signer_relationship)) BETWEEN 2 AND 100),
  -- What the member of staff checked to identify the signer, in their words.
  identity_check      text        NOT NULL CHECK (length(btrim(identity_check)) BETWEEN 3 AND 500),
  method              text        NOT NULL CHECK (method IN ('drawn')),
  -- Compact vector strokes: [[[x, y], ...], ...] with x, y in 0..1 inside the signature box. Never logged or exported.
  strokes             jsonb       NOT NULL CHECK (jsonb_typeof(strokes) = 'array' AND jsonb_array_length(strokes) BETWEEN 1 AND 64),
  signed_at           timestamptz NOT NULL DEFAULT now(),
  -- The member of staff who was present and recorded it.
  witnessed_by        uuid        NOT NULL REFERENCES app_user (id),
  device              text        CHECK (length(device) <= 300),
  UNIQUE (organization_id, id),
  -- One signature per signer kind on a document in this phase; a retry finds the first.
  UNIQUE (organization_id, document_id, signer_kind),
  FOREIGN KEY (organization_id, patient_id, document_id) REFERENCES document (organization_id, patient_id, id),
  CHECK (signer_kind = 'representative' OR signer_relationship IS NULL),
  CHECK (signer_kind = 'patient' OR signer_relationship IS NOT NULL)
);
CREATE INDEX document_signature_document_idx ON document_signature (organization_id, document_id);

CREATE TRIGGER document_signature_append_only BEFORE UPDATE OR DELETE ON document_signature
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- Signing is done where the consent is recorded, so it needs no permission of its own beyond those the routes ask for.
