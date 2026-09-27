-- Patient Master: one canonical identity per organization (CLAUDE.md §5).

CREATE TABLE patient_number_sequence (
  organization_id  uuid   PRIMARY KEY REFERENCES organization (id),
  next_value       bigint NOT NULL DEFAULT 1 CHECK (next_value > 0)
);

CREATE TABLE patient (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL REFERENCES organization (id),
  patient_number           text        NOT NULL,
  family_name              text        NOT NULL CHECK (length(btrim(family_name)) > 0),
  given_name               text        NOT NULL CHECK (length(btrim(given_name)) > 0),
  middle_name              text,
  suffix                   text,
  -- Normalized (lower-case, diacritics removed) copies maintained by the application for search.
  family_name_normalized   text        NOT NULL,
  given_name_normalized    text        NOT NULL,
  name_search              text        NOT NULL,
  sex                      text        NOT NULL CHECK (sex IN ('male', 'female', 'intersex', 'unknown')),
  gender_identity          text,
  birth_date               date        NOT NULL CHECK (birth_date >= DATE '1880-01-01'),
  birth_date_is_estimated  boolean     NOT NULL DEFAULT false,
  civil_status             text        CHECK (civil_status IN ('single', 'married', 'widowed', 'separated', 'annulled', 'unknown')),
  nationality              text        CHECK (nationality ~ '^[A-Z]{2}$'),
  occupation               text,
  status                   text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deceased', 'merged')),
  deceased_at              timestamptz,
  merged_into_patient_id   uuid,
  registered_facility_id   uuid        NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid        NOT NULL REFERENCES app_user (id),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid        NOT NULL REFERENCES app_user (id),
  version                  integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, patient_number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, registered_facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, merged_into_patient_id) REFERENCES patient (organization_id, id),
  CHECK (status <> 'deceased' OR deceased_at IS NOT NULL),
  CHECK ((status = 'merged') = (merged_into_patient_id IS NOT NULL)),
  CHECK (merged_into_patient_id IS NULL OR merged_into_patient_id <> id)
);
CREATE INDEX patient_name_search_trgm_idx ON patient USING gin (name_search gin_trgm_ops);
CREATE INDEX patient_family_name_trgm_idx ON patient USING gin (family_name_normalized gin_trgm_ops);
CREATE INDEX patient_org_birth_date_idx   ON patient (organization_id, birth_date);
CREATE INDEX patient_org_names_idx        ON patient (organization_id, family_name_normalized, given_name_normalized);

CREATE TABLE patient_identifier (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  patient_id        uuid        NOT NULL,
  type              text        NOT NULL CHECK (type IN
                      ('philhealth_pin', 'philsys_number', 'senior_citizen_id', 'pwd_id', 'passport',
                       'drivers_license', 'hmo_member_id', 'external_mrn', 'other')),
  value             text        NOT NULL CHECK (length(btrim(value)) > 0),
  value_normalized  text        NOT NULL CHECK (length(value_normalized) > 0),
  issuer            text,
  valid_from        date,
  valid_until       date,
  status            text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL REFERENCES app_user (id),
  retired_at        timestamptz,
  retired_by        uuid        REFERENCES app_user (id),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from),
  CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);
-- An active identifier value belongs to exactly one patient within an organization.
CREATE UNIQUE INDEX patient_identifier_active_uq
  ON patient_identifier (organization_id, type, coalesce(issuer, ''), value_normalized)
  WHERE status = 'active';
CREATE INDEX patient_identifier_patient_idx ON patient_identifier (patient_id);

CREATE TABLE patient_contact_point (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  patient_id        uuid        NOT NULL,
  system            text        NOT NULL CHECK (system IN ('mobile', 'phone', 'email')),
  value             text        NOT NULL CHECK (length(btrim(value)) > 0),
  value_normalized  text        NOT NULL,
  use               text        NOT NULL DEFAULT 'personal' CHECK (use IN ('personal', 'home', 'work', 'other')),
  is_primary        boolean     NOT NULL DEFAULT false,
  status            text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL REFERENCES app_user (id),
  retired_at        timestamptz,
  retired_by        uuid        REFERENCES app_user (id),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id),
  CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX patient_contact_point_primary_uq
  ON patient_contact_point (patient_id, system) WHERE is_primary AND status = 'active';
CREATE INDEX patient_contact_point_lookup_idx
  ON patient_contact_point (organization_id, value_normalized) WHERE status = 'active';

CREATE TABLE patient_address (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid        NOT NULL,
  patient_id           uuid        NOT NULL,
  use                  text        NOT NULL DEFAULT 'home' CHECK (use IN ('home', 'work', 'temporary', 'billing', 'other')),
  line1                text,
  barangay             text,
  city_municipality    text        NOT NULL,
  province             text,
  region               text,
  postal_code          text        CHECK (postal_code ~ '^[0-9]{4}$'),
  country              text        NOT NULL DEFAULT 'PH' CHECK (country ~ '^[A-Z]{2}$'),
  -- Optional Philippine Standard Geographic Code of the barangay.
  psgc_code            text        CHECK (psgc_code ~ '^[0-9]{9,10}$'),
  is_primary           boolean     NOT NULL DEFAULT false,
  status               text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid        NOT NULL REFERENCES app_user (id),
  retired_at           timestamptz,
  retired_by           uuid        REFERENCES app_user (id),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id),
  CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX patient_address_primary_uq
  ON patient_address (patient_id) WHERE is_primary AND status = 'active';

-- Family relationships, dependents, guardians and emergency contacts.
CREATE TABLE patient_relationship (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            uuid        NOT NULL,
  patient_id                 uuid        NOT NULL,
  related_patient_id         uuid,
  relationship               text        NOT NULL CHECK (relationship IN
                               ('mother', 'father', 'parent', 'spouse', 'partner', 'child', 'sibling', 'guardian',
                                'grandparent', 'grandchild', 'relative', 'friend', 'employer', 'other')),
  name                       text,
  contact_number             text,
  contact_number_normalized  text,
  is_emergency_contact       boolean     NOT NULL DEFAULT false,
  is_legal_guardian          boolean     NOT NULL DEFAULT false,
  notes                      text,
  status                     text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid        NOT NULL REFERENCES app_user (id),
  retired_at                 timestamptz,
  retired_by                 uuid        REFERENCES app_user (id),
  FOREIGN KEY (organization_id, patient_id)         REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, related_patient_id) REFERENCES patient (organization_id, id),
  CHECK (related_patient_id IS NOT NULL OR length(btrim(name)) > 0),
  CHECK (related_patient_id IS NULL OR related_patient_id <> patient_id),
  CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);
CREATE INDEX patient_relationship_patient_idx ON patient_relationship (patient_id);
CREATE INDEX patient_relationship_related_idx ON patient_relationship (related_patient_id) WHERE related_patient_id IS NOT NULL;

-- Consent history is append-only: every decision is a new row.
CREATE TABLE patient_consent (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  patient_id       uuid        NOT NULL,
  consent_type     text        NOT NULL CHECK (consent_type IN
                     ('data_processing', 'treatment_general', 'telemedicine', 'data_sharing_hmo',
                      'data_sharing_philhealth', 'portal_access', 'research')),
  decision         text        NOT NULL CHECK (decision IN ('granted', 'refused', 'withdrawn')),
  effective_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz,
  captured_via     text        NOT NULL CHECK (captured_via IN ('paper', 'electronic', 'verbal')),
  document_id      uuid,
  notes            text,
  recorded_by      uuid        NOT NULL REFERENCES app_user (id),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id),
  CHECK (expires_at IS NULL OR expires_at > effective_at)
);
CREATE INDEX patient_consent_current_idx ON patient_consent (patient_id, consent_type, recorded_at DESC);
CREATE TRIGGER patient_consent_append_only
  BEFORE UPDATE OR DELETE ON patient_consent
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TABLE patient_communication_preference (
  organization_id  uuid        NOT NULL,
  patient_id       uuid        NOT NULL,
  channel          text        NOT NULL CHECK (channel IN ('sms', 'email', 'push', 'in_app')),
  category         text        NOT NULL CHECK (category IN ('clinical', 'administrative', 'outreach')),
  opted_in         boolean     NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid        NOT NULL REFERENCES app_user (id),
  PRIMARY KEY (patient_id, channel, category),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id)
);
