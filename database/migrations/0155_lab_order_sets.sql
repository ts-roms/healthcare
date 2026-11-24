-- Laboratory order sets (docs/domains/laboratory.md, "Order sets"; docs/domains/assistant.md).
--
-- An order set is the organization's own list of tests and panels it orders together (a diabetes follow-up, a
-- pre-employment check), optionally offered for diagnoses whose code starts with a prefix or for a visit type. Doctors
-- choose one in the laboratory order form, and the assistant's rule `laboratory.order-sets` offers a matching one in the
-- consultation; either way it only pre-selects tests: the doctor checks them and places the order. No clinical guideline
-- is shipped: sets and their triggers are configuration (lab.catalog.manage), changed in place with a version, audited.
-- Diagnoses and visit types belong to the clinic, so triggers name them by value (code prefix, visit type code), never by
-- a key into the clinic's tables.

CREATE TABLE lab_order_set (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  code             text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name             text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  -- What the set is for, shown with it (optional).
  note             text        CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 500),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid        NOT NULL REFERENCES app_user (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id)
);

-- What the set orders: tests or panels of the catalogue, in order.
CREATE TABLE lab_order_set_item (
  organization_id  uuid     NOT NULL,
  order_set_id     uuid     NOT NULL,
  position         smallint NOT NULL CHECK (position BETWEEN 1 AND 60),
  test_id          uuid,
  panel_id         uuid,
  CHECK (num_nonnulls(test_id, panel_id) = 1),
  PRIMARY KEY (order_set_id, position),
  FOREIGN KEY (organization_id, order_set_id) REFERENCES lab_order_set (organization_id, id),
  FOREIGN KEY (organization_id, test_id)      REFERENCES lab_test (organization_id, id),
  FOREIGN KEY (organization_id, panel_id)     REFERENCES lab_panel (organization_id, id)
);
CREATE UNIQUE INDEX lab_order_set_item_test ON lab_order_set_item (order_set_id, test_id) WHERE test_id IS NOT NULL;
CREATE UNIQUE INDEX lab_order_set_item_panel ON lab_order_set_item (order_set_id, panel_id) WHERE panel_id IS NOT NULL;

-- When the set is offered: a diagnosis whose code starts with `value` (in one coding system, or any), or a visit type
-- whose code is `value`. A set without triggers is only chosen by hand.
CREATE TABLE lab_order_set_trigger (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid    NOT NULL,
  order_set_id     uuid    NOT NULL,
  kind             text    NOT NULL CHECK (kind IN ('diagnosis_code', 'visit_type')),
  value            text    NOT NULL CHECK (length(btrim(value)) BETWEEN 1 AND 40),
  -- Diagnosis codes only: the coding system key the prefix applies to (null: any).
  code_system_key  text    CHECK (code_system_key IS NULL OR length(btrim(code_system_key)) BETWEEN 1 AND 60),
  CHECK (kind = 'diagnosis_code' OR code_system_key IS NULL),
  FOREIGN KEY (organization_id, order_set_id) REFERENCES lab_order_set (organization_id, id),
  UNIQUE NULLS NOT DISTINCT (order_set_id, kind, value, code_system_key)
);
CREATE INDEX lab_order_set_trigger_set ON lab_order_set_trigger (order_set_id);
