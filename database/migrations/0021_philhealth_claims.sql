-- PhilHealth eClaims: adapter stubs (Phase 8). See docs/interoperability/philhealth-eclaims.md.
--
-- No official eClaims specification is on record, so nothing here models PhilHealth's message formats, codes or
-- validation rules. These tables hold what the platform itself must keep around any external exchange:
--   * each facility's PhilHealth accreditation number (recorded by staff, used when a claim is prepared);
--   * a log of outbound integration exchanges (idempotency key, status, external reference, payload digest).
-- Full request/response payloads contain PHI and are not stored here (libs/interoperability/CLAUDE.md).

CREATE TABLE philhealth_facility_accreditation (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL REFERENCES organization (id),
  facility_id           uuid        NOT NULL,
  accreditation_number  text        NOT NULL CHECK (length(btrim(accreditation_number)) BETWEEN 1 AND 40),
  valid_from            date,
  valid_until           date,
  updated_by            uuid        NOT NULL REFERENCES app_user (id),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer     NOT NULL DEFAULT 1,
  UNIQUE (facility_id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);

-- One row per outbound operation towards an external system. The idempotency key makes a retried request one
-- exchange; the status moves forward as the adapter reports back.
CREATE TABLE integration_exchange (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL REFERENCES organization (id),
  system              text        NOT NULL CHECK (system ~ '^[a-z0-9][a-z0-9.-]{1,48}$'),
  operation           text        NOT NULL CHECK (operation ~ '^[a-z][a-z0-9_]{1,48}$'),
  idempotency_key     text        NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  patient_id          uuid,
  resource_type       text        NOT NULL,
  resource_id         uuid        NOT NULL,
  status              text        NOT NULL DEFAULT 'queued'
                                  CHECK (status IN ('queued', 'accepted', 'rejected', 'failed', 'not_configured')),
  attempts            integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- SHA-256 of the prepared payload: proves what was sent without keeping PHI in this table.
  payload_digest      text        NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  external_reference  text,
  -- Reasons and codes returned by the external system (no clinical free text).
  outcome_detail      jsonb       NOT NULL DEFAULT '{}',
  last_error          text,
  requested_by        uuid        NOT NULL REFERENCES app_user (id),
  requested_at        timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  UNIQUE (organization_id, system, idempotency_key),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id),
  CHECK ((status = 'queued') = (completed_at IS NULL))
);
CREATE INDEX integration_exchange_resource ON integration_exchange (organization_id, resource_type, resource_id, requested_at);

-- ---- permissions --------------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('philhealth.claim.submit',     'Prepare PhilHealth claims from issued invoices and request their submission'),
  ('philhealth.settings.manage',  'Record facility PhilHealth accreditation numbers');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, p.key FROM role r CROSS JOIN permission p
WHERE r.key = 'org_admin' AND r.is_system AND p.key LIKE 'philhealth.%'
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'philhealth.claim.submit' FROM role r
WHERE r.key = 'cashier' AND r.is_system
ON CONFLICT DO NOTHING;
