-- Laboratory Information System (Phase 3). See libs/laboratory/CLAUDE.md and docs/domains/laboratory.md.
--
-- Catalog (departments, specimen types, tests, versioned reference ranges, panels) is organization
-- configuration. Orders → specimens (accession numbers per facility) → results. Results are
-- versioned and never overwritten: a correction adds a new version and supersedes the old one.

-- ---------------------------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------------------------

CREATE TABLE lab_department (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  code             text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name             text        NOT NULL CHECK (length(btrim(name)) > 0),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id)
);

CREATE TABLE lab_specimen_type (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL REFERENCES organization (id),
  code                     text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name                     text        NOT NULL CHECK (length(btrim(name)) > 0),
  container                text,
  collection_instructions  text,
  status                   text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id)
);

CREATE TABLE lab_test (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL,
  code                     text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name                     text        NOT NULL CHECK (length(btrim(name)) > 0),
  department_id            uuid        NOT NULL,
  specimen_type_id         uuid        NOT NULL,
  -- Optional LOINC code: the normalized analyte identifier used for trends when present.
  loinc_code               text        CHECK (loinc_code ~ '^[0-9]{1,7}-[0-9]$'),
  result_type              text        NOT NULL CHECK (result_type IN ('numeric', 'text', 'coded')),
  unit                     text,
  decimal_places           smallint    CHECK (decimal_places BETWEEN 0 AND 6),
  coded_values             text[]      NOT NULL DEFAULT '{}',
  abnormal_coded_values    text[]      NOT NULL DEFAULT '{}',
  turnaround_minutes       integer     CHECK (turnaround_minutes > 0),
  requires_fasting         boolean     NOT NULL DEFAULT false,
  -- Whether released results of this test may be shown to the patient (e.g. some tests need counselling first).
  patient_releasable       boolean     NOT NULL DEFAULT true,
  collection_instructions  text,
  status                   text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, department_id)    REFERENCES lab_department (organization_id, id),
  FOREIGN KEY (organization_id, specimen_type_id) REFERENCES lab_specimen_type (organization_id, id),
  CHECK (result_type <> 'coded' OR cardinality(coded_values) > 0),
  CHECK (result_type = 'coded' OR (cardinality(coded_values) = 0 AND cardinality(abnormal_coded_values) = 0)),
  CHECK (abnormal_coded_values <@ coded_values),
  CHECK (result_type = 'numeric' OR decimal_places IS NULL)
);

-- Reference ranges are versioned by effective period. A new range for the same sex and age band
-- closes the previous one (effective_to); results keep a snapshot of the range used.
CREATE TABLE lab_reference_range (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  test_id          uuid        NOT NULL,
  -- NULL = any sex. A sex-specific range takes precedence over an "any" range for the same age.
  sex              text        CHECK (sex IN ('male', 'female')),
  age_min_days     integer     NOT NULL DEFAULT 0 CHECK (age_min_days >= 0),
  -- Exclusive upper bound; NULL = no upper limit.
  age_max_days     integer,
  low              numeric,
  high             numeric,
  critical_low     numeric,
  critical_high    numeric,
  text_range       text,
  effective_from   timestamptz NOT NULL DEFAULT now(),
  effective_to     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, test_id) REFERENCES lab_test (organization_id, id),
  CHECK (age_max_days IS NULL OR age_max_days > age_min_days),
  CHECK (low IS NULL OR high IS NULL OR low <= high),
  CHECK (critical_low IS NULL OR low IS NULL OR critical_low <= low),
  CHECK (critical_high IS NULL OR high IS NULL OR critical_high >= high),
  CHECK (low IS NOT NULL OR high IS NOT NULL OR critical_low IS NOT NULL OR critical_high IS NOT NULL OR length(btrim(text_range)) > 0),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT lab_reference_range_no_overlap EXCLUDE USING gist (
    test_id WITH =,
    (coalesce(sex, 'any')) WITH =,
    int4range(age_min_days, age_max_days) WITH &&,
    tstzrange(effective_from, effective_to) WITH &&
  )
);

-- Ranges are history: only closing an open range (setting effective_to) is allowed.
CREATE FUNCTION lab_reference_range_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reference ranges cannot be deleted; close them instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.effective_to IS NOT NULL
     OR (NEW.organization_id, NEW.test_id, NEW.sex, NEW.age_min_days, NEW.age_max_days, NEW.low, NEW.high,
         NEW.critical_low, NEW.critical_high, NEW.text_range, NEW.effective_from, NEW.created_at, NEW.created_by)
        IS DISTINCT FROM
        (OLD.organization_id, OLD.test_id, OLD.sex, OLD.age_min_days, OLD.age_max_days, OLD.low, OLD.high,
         OLD.critical_low, OLD.critical_high, OLD.text_range, OLD.effective_from, OLD.created_at, OLD.created_by) THEN
    RAISE EXCEPTION 'reference ranges are immutable; add a new range instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lab_reference_range_immutable BEFORE UPDATE OR DELETE ON lab_reference_range
  FOR EACH ROW EXECUTE FUNCTION lab_reference_range_guard();

CREATE TABLE lab_panel (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  code             text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name             text        NOT NULL CHECK (length(btrim(name)) > 0),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id)
);

CREATE TABLE lab_panel_test (
  organization_id  uuid     NOT NULL,
  panel_id         uuid     NOT NULL,
  test_id          uuid     NOT NULL,
  position         smallint NOT NULL CHECK (position > 0),
  PRIMARY KEY (panel_id, test_id),
  UNIQUE (panel_id, position),
  FOREIGN KEY (organization_id, panel_id) REFERENCES lab_panel (organization_id, id),
  FOREIGN KEY (organization_id, test_id)  REFERENCES lab_test (organization_id, id)
);

-- Per-facility laboratory policy. Defaults are the safe choice (separation of duties, manual release).
CREATE TABLE lab_facility_policy (
  facility_id              uuid        PRIMARY KEY,
  organization_id          uuid        NOT NULL,
  allow_self_verification  boolean     NOT NULL DEFAULT false,
  allow_self_approval      boolean     NOT NULL DEFAULT false,
  release_on_approval      boolean     NOT NULL DEFAULT false,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid        NOT NULL REFERENCES app_user (id),
  version                  integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id)
);

-- ---------------------------------------------------------------------------------------------
-- Orders and specimens
-- ---------------------------------------------------------------------------------------------

CREATE TABLE lab_order_number_sequence (
  organization_id  uuid   PRIMARY KEY REFERENCES organization (id),
  next_value       bigint NOT NULL CHECK (next_value > 0)
);

-- Accession numbers are unique per facility: YYMMDD (facility-local date) + a daily counter.
CREATE TABLE lab_accession_sequence (
  facility_id     uuid    NOT NULL REFERENCES facility (id),
  accession_date  date    NOT NULL,
  next_value      integer NOT NULL CHECK (next_value > 0),
  PRIMARY KEY (facility_id, accession_date)
);

CREATE TABLE lab_order (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid        NOT NULL,
  facility_id               uuid        NOT NULL,
  patient_id                uuid        NOT NULL,
  encounter_id              uuid,
  ordering_practitioner_id  uuid,
  -- For external orders: the requesting physician as written on the request form.
  external_orderer          text,
  order_number              text        NOT NULL,
  source                    text        NOT NULL CHECK (source IN ('clinic', 'telemedicine', 'dental', 'external', 'patient_request')),
  priority                  text        NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine', 'stat', 'scheduled')),
  scheduled_for             timestamptz,
  clinical_indication       text,
  notes                     text,
  fasting_required          boolean     NOT NULL DEFAULT false,
  status                    text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  ordered_at                timestamptz NOT NULL DEFAULT now(),
  ordered_by                uuid        NOT NULL REFERENCES app_user (id),
  completed_at              timestamptz,
  cancelled_at              timestamptz,
  cancelled_by              uuid        REFERENCES app_user (id),
  cancellation_reason       text,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  version                   integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, order_number),
  UNIQUE (organization_id, id),
  UNIQUE (patient_id, id),
  FOREIGN KEY (organization_id, facility_id)              REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)               REFERENCES patient (organization_id, id),
  FOREIGN KEY (patient_id, encounter_id)                  REFERENCES encounter (patient_id, id),
  FOREIGN KEY (organization_id, ordering_practitioner_id) REFERENCES practitioner (organization_id, id),
  CHECK (priority <> 'scheduled' OR scheduled_for IS NOT NULL),
  CHECK (ordering_practitioner_id IS NOT NULL OR source IN ('external', 'patient_request')),
  CHECK (source <> 'external' OR ordering_practitioner_id IS NOT NULL OR length(btrim(external_orderer)) > 0),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK (cancelled_at IS NULL OR length(btrim(cancellation_reason)) > 0),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX lab_order_patient_idx ON lab_order (patient_id, ordered_at DESC);
CREATE INDEX lab_order_facility_active_idx ON lab_order (facility_id, ordered_at) WHERE status = 'active';

CREATE TABLE lab_specimen (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  facility_id       uuid        NOT NULL,
  patient_id        uuid        NOT NULL,
  order_id          uuid        NOT NULL,
  specimen_type_id  uuid        NOT NULL,
  accession_number  text        NOT NULL CHECK (accession_number ~ '^[0-9]{10,}$'),
  status            text        NOT NULL DEFAULT 'collected' CHECK (status IN ('collected', 'received', 'rejected', 'stored', 'disposed')),
  collected_at      timestamptz NOT NULL,
  collected_by      uuid        NOT NULL REFERENCES app_user (id),
  received_at       timestamptz,
  received_by       uuid        REFERENCES app_user (id),
  rejected_at       timestamptz,
  rejected_by       uuid        REFERENCES app_user (id),
  rejection_reason  text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (facility_id, accession_number),
  UNIQUE (organization_id, id),
  UNIQUE (patient_id, id),
  FOREIGN KEY (organization_id, facility_id)      REFERENCES facility (organization_id, id),
  FOREIGN KEY (patient_id, order_id)              REFERENCES lab_order (patient_id, id),
  FOREIGN KEY (organization_id, specimen_type_id) REFERENCES lab_specimen_type (organization_id, id),
  CHECK ((status = 'rejected') = (rejected_at IS NOT NULL)),
  CHECK (rejected_at IS NULL OR length(btrim(rejection_reason)) > 0),
  CHECK (status IN ('collected', 'rejected') OR received_at IS NOT NULL)
);
CREATE INDEX lab_specimen_order_idx ON lab_specimen (order_id);

-- Every specimen transition, with who, when and why. Append-only.
CREATE TABLE lab_specimen_event (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  specimen_id      uuid        NOT NULL,
  event            text        NOT NULL CHECK (event IN ('collected', 'received', 'rejected', 'recollection_requested', 'routed', 'stored', 'disposed')),
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  actor_user_id    uuid        NOT NULL REFERENCES app_user (id),
  reason           text,
  FOREIGN KEY (organization_id, specimen_id) REFERENCES lab_specimen (organization_id, id),
  CHECK (event NOT IN ('rejected', 'recollection_requested') OR length(btrim(reason)) > 0)
);
CREATE INDEX lab_specimen_event_specimen_idx ON lab_specimen_event (specimen_id, occurred_at);
CREATE TRIGGER lab_specimen_event_append_only BEFORE UPDATE OR DELETE ON lab_specimen_event
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TABLE lab_order_item (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid        NOT NULL,
  patient_id           uuid        NOT NULL,
  order_id             uuid        NOT NULL,
  test_id              uuid        NOT NULL,
  -- Snapshot of the catalog entry at ordering time.
  test_code            text        NOT NULL,
  test_name            text        NOT NULL,
  panel_id             uuid,
  panel_code           text,
  specimen_id          uuid,
  status               text        NOT NULL DEFAULT 'pending_collection'
                         CHECK (status IN ('pending_collection', 'collected', 'received', 'resulted', 'released', 'cancelled')),
  cancelled_at         timestamptz,
  cancelled_by         uuid        REFERENCES app_user (id),
  cancellation_reason  text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (order_id, test_id),
  UNIQUE (patient_id, id),
  FOREIGN KEY (patient_id, order_id)         REFERENCES lab_order (patient_id, id),
  FOREIGN KEY (organization_id, test_id)     REFERENCES lab_test (organization_id, id),
  FOREIGN KEY (organization_id, panel_id)    REFERENCES lab_panel (organization_id, id),
  FOREIGN KEY (patient_id, specimen_id)      REFERENCES lab_specimen (patient_id, id),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK (cancelled_at IS NULL OR length(btrim(cancellation_reason)) > 0),
  CHECK (status IN ('pending_collection', 'cancelled') OR specimen_id IS NOT NULL),
  CHECK ((panel_id IS NULL) = (panel_code IS NULL))
);
CREATE INDEX lab_order_item_order_idx ON lab_order_item (order_id);
CREATE INDEX lab_order_item_specimen_idx ON lab_order_item (specimen_id);

-- ---------------------------------------------------------------------------------------------
-- Results
-- ---------------------------------------------------------------------------------------------

CREATE TABLE lab_result (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL,
  facility_id           uuid        NOT NULL,
  patient_id            uuid        NOT NULL,
  order_id              uuid        NOT NULL,
  order_item_id         uuid        NOT NULL,
  test_id               uuid        NOT NULL,
  version_number        smallint    NOT NULL CHECK (version_number > 0),
  supersedes_result_id  uuid        REFERENCES lab_result (id),
  -- Why this version replaced the previous one (required for every version after the first).
  correction_reason     text,
  status                text        NOT NULL DEFAULT 'entered'
                          CHECK (status IN ('entered', 'verified', 'approved', 'released', 'superseded', 'cancelled')),
  result_type           text        NOT NULL CHECK (result_type IN ('numeric', 'text', 'coded')),
  value_numeric         numeric,
  value_text            text,
  value_coded           text,
  unit                  text,
  flag                  text        CHECK (flag IN ('normal', 'low', 'high', 'critical_low', 'critical_high', 'abnormal')),
  critical              boolean     NOT NULL DEFAULT false,
  -- Snapshot of the reference range applied at entry; later catalog changes never alter it.
  reference_range_id    uuid,
  ref_low               numeric,
  ref_high              numeric,
  ref_critical_low      numeric,
  ref_critical_high     numeric,
  ref_text              text,
  comment               text,
  method                text,
  instrument            text,
  patient_releasable    boolean     NOT NULL,
  entered_at            timestamptz NOT NULL DEFAULT now(),
  entered_by            uuid        NOT NULL REFERENCES app_user (id),
  verified_at           timestamptz,
  verified_by           uuid        REFERENCES app_user (id),
  self_verified         boolean     NOT NULL DEFAULT false,
  approved_at           timestamptz,
  approved_by           uuid        REFERENCES app_user (id),
  self_approved         boolean     NOT NULL DEFAULT false,
  released_at           timestamptz,
  released_by           uuid        REFERENCES app_user (id),
  superseded_at         timestamptz,
  cancelled_at          timestamptz,
  cancelled_by          uuid        REFERENCES app_user (id),
  cancellation_reason   text,
  UNIQUE (order_item_id, version_number),
  UNIQUE (organization_id, id),
  UNIQUE (patient_id, id),
  FOREIGN KEY (organization_id, facility_id)        REFERENCES facility (organization_id, id),
  FOREIGN KEY (patient_id, order_id)                REFERENCES lab_order (patient_id, id),
  FOREIGN KEY (patient_id, order_item_id)           REFERENCES lab_order_item (patient_id, id),
  FOREIGN KEY (organization_id, test_id)            REFERENCES lab_test (organization_id, id),
  FOREIGN KEY (organization_id, reference_range_id) REFERENCES lab_reference_range (organization_id, id),
  CHECK (
    (result_type = 'numeric' AND value_numeric IS NOT NULL AND value_text IS NULL AND value_coded IS NULL) OR
    (result_type = 'text'    AND value_numeric IS NULL AND length(btrim(value_text)) > 0 AND value_coded IS NULL) OR
    (result_type = 'coded'   AND value_numeric IS NULL AND value_text IS NULL AND length(btrim(value_coded)) > 0)
  ),
  CHECK (flag IS NULL OR flag NOT IN ('critical_low', 'critical_high') OR critical),
  CHECK ((version_number = 1) = (supersedes_result_id IS NULL)),
  CHECK (supersedes_result_id IS NULL OR length(btrim(correction_reason)) > 0),
  CHECK (status NOT IN ('verified', 'approved', 'released') OR verified_at IS NOT NULL),
  CHECK (status NOT IN ('approved', 'released') OR approved_at IS NOT NULL),
  CHECK (status <> 'released' OR released_at IS NOT NULL),
  CHECK ((verified_at IS NULL) = (verified_by IS NULL)),
  CHECK ((approved_at IS NULL) = (approved_by IS NULL)),
  CHECK ((released_at IS NULL) = (released_by IS NULL)),
  CHECK (approved_at IS NULL OR verified_at IS NOT NULL),
  CHECK (released_at IS NULL OR approved_at IS NOT NULL),
  CHECK ((status = 'superseded') = (superseded_at IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK (cancelled_at IS NULL OR length(btrim(cancellation_reason)) > 0),
  -- Separation of duties: the person who entered a result does not verify or approve it,
  -- unless the facility policy allowed it at the time (recorded on the result).
  CHECK (verified_by IS NULL OR verified_by <> entered_by OR self_verified),
  CHECK (approved_by IS NULL OR approved_by <> entered_by OR self_approved)
);
-- At most one current (not superseded or cancelled) result per order item.
CREATE UNIQUE INDEX lab_result_current_idx ON lab_result (order_item_id) WHERE status NOT IN ('superseded', 'cancelled');
CREATE INDEX lab_result_patient_idx ON lab_result (patient_id, test_id, released_at) WHERE status = 'released';

-- Result values are immutable; only the status moves forward:
--   entered → verified → approved → released, any unreleased state → cancelled,
--   any current state → superseded (by a new version). Nothing after superseded or cancelled.
CREATE FUNCTION lab_result_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'laboratory results cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.organization_id, NEW.facility_id, NEW.patient_id, NEW.order_id, NEW.order_item_id, NEW.test_id, NEW.version_number,
      NEW.supersedes_result_id, NEW.correction_reason, NEW.result_type, NEW.value_numeric, NEW.value_text, NEW.value_coded,
      NEW.unit, NEW.flag, NEW.critical, NEW.reference_range_id, NEW.ref_low, NEW.ref_high, NEW.ref_critical_low,
      NEW.ref_critical_high, NEW.ref_text, NEW.comment, NEW.method, NEW.instrument, NEW.patient_releasable,
      NEW.entered_at, NEW.entered_by)
     IS DISTINCT FROM
     (OLD.organization_id, OLD.facility_id, OLD.patient_id, OLD.order_id, OLD.order_item_id, OLD.test_id, OLD.version_number,
      OLD.supersedes_result_id, OLD.correction_reason, OLD.result_type, OLD.value_numeric, OLD.value_text, OLD.value_coded,
      OLD.unit, OLD.flag, OLD.critical, OLD.reference_range_id, OLD.ref_low, OLD.ref_high, OLD.ref_critical_low,
      OLD.ref_critical_high, OLD.ref_text, OLD.comment, OLD.method, OLD.instrument, OLD.patient_releasable,
      OLD.entered_at, OLD.entered_by) THEN
    RAISE EXCEPTION 'laboratory result values are immutable; enter a corrected version instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'entered'  AND NEW.status IN ('verified', 'superseded', 'cancelled')) OR
       (OLD.status = 'verified' AND NEW.status IN ('approved', 'superseded', 'cancelled')) OR
       (OLD.status = 'approved' AND NEW.status IN ('released', 'superseded', 'cancelled')) OR
       (OLD.status = 'released' AND NEW.status = 'superseded')
     ) THEN
    RAISE EXCEPTION 'laboratory result cannot move from % to %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('superseded', 'cancelled') THEN
    RAISE EXCEPTION 'laboratory result is % and can no longer change', OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Sign-offs, once recorded, are never rewritten.
  IF (OLD.verified_at IS NOT NULL AND (NEW.verified_at, NEW.verified_by, NEW.self_verified) IS DISTINCT FROM (OLD.verified_at, OLD.verified_by, OLD.self_verified))
     OR (OLD.approved_at IS NOT NULL AND (NEW.approved_at, NEW.approved_by, NEW.self_approved) IS DISTINCT FROM (OLD.approved_at, OLD.approved_by, OLD.self_approved))
     OR (OLD.released_at IS NOT NULL AND (NEW.released_at, NEW.released_by) IS DISTINCT FROM (OLD.released_at, OLD.released_by)) THEN
    RAISE EXCEPTION 'laboratory result sign-offs cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lab_result_immutable BEFORE UPDATE OR DELETE ON lab_result
  FOR EACH ROW EXECUTE FUNCTION lab_result_guard();

-- Critical results: raised when a critical result is verified; lab staff document who was told,
-- how and whether the value was read back; the ordering side acknowledges.
CREATE TABLE lab_critical_alert (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL,
  facility_id           uuid        NOT NULL,
  patient_id            uuid        NOT NULL,
  result_id             uuid        NOT NULL UNIQUE,
  status                text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'communicated', 'acknowledged')),
  raised_at             timestamptz NOT NULL DEFAULT now(),
  communicated_at       timestamptz,
  communicated_by       uuid        REFERENCES app_user (id),
  communicated_to       text,
  communication_method  text        CHECK (communication_method IN ('phone', 'in_person', 'secure_message', 'other')),
  read_back_confirmed   boolean,
  communication_note    text,
  acknowledged_at       timestamptz,
  acknowledged_by       uuid        REFERENCES app_user (id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (patient_id, result_id)        REFERENCES lab_result (patient_id, id),
  CHECK ((communicated_at IS NULL) = (communicated_by IS NULL)),
  CHECK (communicated_at IS NULL OR (length(btrim(communicated_to)) > 0 AND communication_method IS NOT NULL AND read_back_confirmed IS NOT NULL)),
  CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL)),
  CHECK (status <> 'communicated' OR communicated_at IS NOT NULL),
  CHECK (status <> 'acknowledged' OR acknowledged_at IS NOT NULL),
  CHECK (status <> 'open' OR (communicated_at IS NULL AND acknowledged_at IS NULL))
);
CREATE INDEX lab_critical_alert_open_idx ON lab_critical_alert (facility_id, raised_at) WHERE status <> 'acknowledged';
CREATE TRIGGER lab_critical_alert_no_delete BEFORE DELETE ON lab_critical_alert
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---------------------------------------------------------------------------------------------
-- Permissions and roles
-- ---------------------------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('lab.catalog.manage',     'Manage the laboratory catalog, reference ranges, panels and facility laboratory policy'),
  ('lab.order.read',         'View laboratory orders, specimens and worklists'),
  ('lab.order.create',       'Order laboratory tests'),
  ('lab.order.cancel',       'Cancel laboratory orders and order items'),
  ('lab.specimen.collect',   'Collect specimens (assigns accession numbers)'),
  ('lab.specimen.receive',   'Receive specimens in the laboratory'),
  ('lab.specimen.reject',    'Reject specimens and request recollection'),
  ('lab.result.read',        'View laboratory results'),
  ('lab.result.enter',       'Enter laboratory results'),
  ('lab.result.verify',      'Verify laboratory results'),
  ('lab.result.approve',     'Approve (authorize) laboratory results'),
  ('lab.result.release',     'Release approved laboratory results'),
  ('lab.result.amend',       'Correct released laboratory results (creates a new version)'),
  ('lab.critical.manage',    'Document the communication of critical laboratory results'),
  ('lab.dashboard.read',     'View the laboratory dashboard');

INSERT INTO role (key, name, description, is_system) VALUES
  ('medical_technologist', 'Medical technologist', 'Laboratory specimen handling, result entry and verification', true),
  ('pathologist',          'Pathologist',          'Laboratory result approval, release and correction',        true),
  ('phlebotomist',         'Phlebotomist',         'Specimen collection',                                         true);

-- Organization administrators hold every permission.
INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, p.key FROM role r CROSS JOIN permission p
WHERE r.key = 'org_admin' AND r.is_system
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('physician', 'lab.order.read'), ('physician', 'lab.order.create'), ('physician', 'lab.order.cancel'), ('physician', 'lab.result.read'),
  ('nurse', 'lab.order.read'), ('nurse', 'lab.result.read'), ('nurse', 'lab.specimen.collect'),
  ('records_officer', 'lab.order.read'), ('records_officer', 'lab.result.read'),
  ('medical_technologist', 'organization.read'), ('medical_technologist', 'patient.search'), ('medical_technologist', 'patient.read'),
  ('medical_technologist', 'lab.order.read'), ('medical_technologist', 'lab.order.create'), ('medical_technologist', 'lab.specimen.collect'),
  ('medical_technologist', 'lab.specimen.receive'), ('medical_technologist', 'lab.specimen.reject'), ('medical_technologist', 'lab.result.read'),
  ('medical_technologist', 'lab.result.enter'), ('medical_technologist', 'lab.result.verify'), ('medical_technologist', 'lab.critical.manage'),
  ('medical_technologist', 'lab.dashboard.read'),
  ('pathologist', 'organization.read'), ('pathologist', 'patient.search'), ('pathologist', 'patient.read'),
  ('pathologist', 'lab.catalog.manage'), ('pathologist', 'lab.order.read'), ('pathologist', 'lab.result.read'),
  ('pathologist', 'lab.result.verify'), ('pathologist', 'lab.result.approve'), ('pathologist', 'lab.result.release'),
  ('pathologist', 'lab.result.amend'), ('pathologist', 'lab.critical.manage'), ('pathologist', 'lab.dashboard.read'),
  ('phlebotomist', 'organization.read'), ('phlebotomist', 'patient.search'), ('phlebotomist', 'patient.read'),
  ('phlebotomist', 'lab.order.read'), ('phlebotomist', 'lab.specimen.collect')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system;
