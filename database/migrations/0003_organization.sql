CREATE TABLE organization (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name        text        NOT NULL CHECK (length(btrim(name)) > 0),
  status      text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer     NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE facility (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES organization (id),
  code               text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name               text        NOT NULL CHECK (length(btrim(name)) > 0),
  facility_type      text        NOT NULL CHECK (facility_type IN
                       ('clinic', 'laboratory', 'dental_clinic', 'hospital', 'diagnostic_center', 'telemedicine_hub', 'other')),
  -- Philippine address. Validation beyond shape belongs in the application.
  address_line       text,
  barangay           text,
  city_municipality  text,
  province           text,
  region             text,
  postal_code        text        CHECK (postal_code ~ '^[0-9]{4}$'),
  contact_number     text,
  email              text        CHECK (email = lower(email)),
  -- Recorded for reference only; the platform does not validate licensing.
  license_number     text,
  timezone           text        NOT NULL DEFAULT 'Asia/Manila',
  status             text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, code),
  -- Target for composite FKs that guarantee same-organization references.
  UNIQUE (organization_id, id)
);

CREATE TABLE department (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  facility_id      uuid        NOT NULL,
  code             text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name             text        NOT NULL CHECK (length(btrim(name)) > 0),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  UNIQUE (facility_id, code),
  UNIQUE (facility_id, id)
);
