-- Route templates (docs/domains/clinic.md, "Route templates"; ADR-0014 follow-up).
--
-- A facility names the routes it plans again and again — "Annual check-up: Triage Room → Laboratory → X-ray →
-- Consultation" — so the nurse picks one instead of adding each stop by hand. A template is only a recipe: applying
-- it writes the ordinary visit route (visit_route_step), so the planning rules, the progress and the waiting-room
-- announcements are unchanged, and editing a template later never changes a route already planned. Nothing clinical
-- chooses a template: a person does, or a visit type's default is offered and the nurse may change it.

CREATE TABLE route_template (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  facility_id      uuid        NOT NULL,
  code             text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{0,48}$'),
  name             text        NOT NULL CHECK (length(btrim(name)) > 0),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  UNIQUE (facility_id, code),
  UNIQUE (organization_id, id),
  UNIQUE (facility_id, id)
);

-- The stops in order. The same service point may appear more than once (laboratory, X-ray, laboratory again), but
-- never twice in a row — the service checks that, as for a visit's own route.
CREATE TABLE route_template_step (
  organization_id   uuid    NOT NULL,
  facility_id       uuid    NOT NULL,
  route_template_id uuid    NOT NULL,
  position          integer NOT NULL CHECK (position BETWEEN 1 AND 10),
  service_point_id  uuid    NOT NULL,
  PRIMARY KEY (route_template_id, position),
  FOREIGN KEY (facility_id, route_template_id) REFERENCES route_template (facility_id, id) ON DELETE CASCADE,
  FOREIGN KEY (facility_id, service_point_id)  REFERENCES service_point (facility_id, id)
);

-- The template offered first for a visit type at a facility (visit types belong to the organization, routes to a
-- facility). One default per visit type and facility.
CREATE TABLE route_template_default (
  organization_id   uuid        NOT NULL,
  facility_id       uuid        NOT NULL,
  visit_type_id     uuid        NOT NULL,
  route_template_id uuid        NOT NULL,
  updated_by        uuid        NOT NULL REFERENCES app_user (id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (facility_id, visit_type_id),
  FOREIGN KEY (organization_id, visit_type_id) REFERENCES visit_type (organization_id, id),
  FOREIGN KEY (facility_id, route_template_id) REFERENCES route_template (facility_id, id) ON DELETE CASCADE
);
CREATE INDEX route_template_default_template_idx ON route_template_default (route_template_id);
