-- Compliance configuration (docs/architecture/compliance-configuration.md).
--
-- No official BIR, Dangerous Drugs Board, DOH, National Privacy Commission or public procurement text is on record, so
-- nothing here encodes a government rule, rate, period, deadline or form. Every value below is entered by the
-- organization from the issuances and advice it follows, and each area records who validated that configuration.

-- ---- Compliance reviews (organization) ---------------------------------------------------------------------------
-- Who reviewed an area's configuration against current official requirements (the organization's adviser), when and
-- with what reference. Append-only: a later review is a new row.
CREATE TABLE compliance_review (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  area             text        NOT NULL CHECK (area IN ('billing_tax', 'procurement', 'controlled_drugs', 'laboratory_licensing',
                                                        'doh_reporting', 'data_privacy', 'dental_estimates')),
  outcome          text        NOT NULL CHECK (outcome IN ('validated', 'changes_needed')),
  reviewer_name    text        NOT NULL CHECK (length(btrim(reviewer_name)) BETWEEN 2 AND 120),
  reviewer_role    text        NOT NULL CHECK (length(btrim(reviewer_role)) BETWEEN 2 AND 120),
  -- The issuances or engagement the review was made against, as the reviewer wrote them.
  reference        text        NOT NULL CHECK (length(btrim(reference)) BETWEEN 3 AND 500),
  reviewed_on      date        NOT NULL,
  note             text        CHECK (length(note) <= 1000),
  recorded_by      uuid        NOT NULL REFERENCES app_user (id),
  recorded_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX compliance_review_area ON compliance_review (organization_id, area, reviewed_on DESC, recorded_at DESC);
CREATE TRIGGER compliance_review_append_only BEFORE UPDATE OR DELETE ON compliance_review
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- Tax and procurement (inventory) -----------------------------------------------------------------------------
-- The organization's own withholding codes (as its accountant defines them). The rate is shown for reference only:
-- the withheld amount is entered by staff; the platform does not compute a tax base.
CREATE TABLE inventory_withholding_code (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  code             text        NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 20),
  description      text        NOT NULL CHECK (length(btrim(description)) BETWEEN 3 AND 200),
  -- Basis points, e.g. 100 = 1%; for reference.
  rate_basis_points integer    CHECK (rate_basis_points BETWEEN 0 AND 10000),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX inventory_withholding_code_active ON inventory_withholding_code (organization_id, lower(btrim(code))) WHERE status = 'active';

-- What was withheld when a supplier invoice was paid (entered by staff), and the reference of the certificate given.
ALTER TABLE inventory_supplier_invoice
  ADD COLUMN withholding_code_id   uuid,
  ADD COLUMN withheld_amount       bigint NOT NULL DEFAULT 0 CHECK (withheld_amount >= 0),
  ADD COLUMN withholding_reference text   CHECK (length(btrim(withholding_reference)) BETWEEN 1 AND 80),
  ADD CONSTRAINT inventory_supplier_invoice_withholding_code
    FOREIGN KEY (organization_id, withholding_code_id) REFERENCES inventory_withholding_code (organization_id, id),
  ADD CONSTRAINT inventory_supplier_invoice_withheld_within CHECK (withheld_amount <= total),
  -- Recorded only with the payment; a code goes with an amount.
  ADD CONSTRAINT inventory_supplier_invoice_withheld_when_paid
    CHECK (status = 'paid' OR (withholding_code_id IS NULL AND withheld_amount = 0 AND withholding_reference IS NULL)),
  ADD CONSTRAINT inventory_supplier_invoice_withheld_code CHECK ((withheld_amount > 0) = (withholding_code_id IS NOT NULL));

-- The organization's own procurement methods (e.g. the modes its procurement rules name), and whether an order made
-- under one needs a reference.
CREATE TABLE inventory_procurement_method (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES organization (id),
  code               text        NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 20),
  name               text        NOT NULL CHECK (length(btrim(name)) BETWEEN 3 AND 120),
  -- What the reference is (e.g. "Posting reference"); required on orders when set.
  reference_label    text        CHECK (length(btrim(reference_label)) BETWEEN 3 AND 60),
  status             text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by         uuid        NOT NULL REFERENCES app_user (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX inventory_procurement_method_active ON inventory_procurement_method (organization_id, lower(btrim(code))) WHERE status = 'active';

ALTER TABLE inventory_purchase_order
  ADD COLUMN procurement_method_id uuid,
  ADD COLUMN procurement_reference text CHECK (length(btrim(procurement_reference)) BETWEEN 1 AND 80),
  ADD CONSTRAINT inventory_purchase_order_procurement_method
    FOREIGN KEY (organization_id, procurement_method_id) REFERENCES inventory_procurement_method (organization_id, id);

-- ---- Controlled drug register (inventory) ------------------------------------------------------------------------
-- What the facility prints on its register of controlled items, as the organization records it (not verified).
CREATE TABLE inventory_controlled_register_setting (
  organization_id     uuid        NOT NULL REFERENCES organization (id),
  facility_id         uuid        NOT NULL,
  licence_reference   text        CHECK (length(btrim(licence_reference)) BETWEEN 1 AND 80),
  responsible_person  text        CHECK (length(btrim(responsible_person)) BETWEEN 2 AND 160),
  note                text        CHECK (length(note) <= 500),
  updated_by          uuid        NOT NULL REFERENCES app_user (id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (facility_id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id)
);
CREATE INDEX inventory_movement_register ON inventory_movement (organization_id, item_id, location_id, recorded_at);

-- ---- Laboratory licence (laboratory) -----------------------------------------------------------------------------
-- The facility's laboratory licence as issued (recorded by staff, not verified). Append-only: a renewal is a new row.
CREATE TABLE lab_facility_licence (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL REFERENCES organization (id),
  facility_id           uuid        NOT NULL,
  licence_number        text        NOT NULL CHECK (length(btrim(licence_number)) BETWEEN 1 AND 60),
  -- The classification and issuing office as written on the licence.
  classification        text        CHECK (length(btrim(classification)) BETWEEN 1 AND 120),
  issued_by             text        CHECK (length(btrim(issued_by)) BETWEEN 2 AND 160),
  valid_from            date        NOT NULL,
  valid_until           date        NOT NULL,
  head_name             text        CHECK (length(btrim(head_name)) BETWEEN 2 AND 160),
  head_licence_number   text        CHECK (length(btrim(head_licence_number)) BETWEEN 1 AND 40),
  -- How many days before expiry the dashboard reminds (the organization's choice).
  reminder_days         smallint    NOT NULL DEFAULT 60 CHECK (reminder_days BETWEEN 0 AND 365),
  recorded_by           uuid        NOT NULL REFERENCES app_user (id),
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  CHECK (valid_until >= valid_from)
);
CREATE INDEX lab_facility_licence_facility ON lab_facility_licence (facility_id, recorded_at DESC);
CREATE TRIGGER lab_facility_licence_append_only BEFORE UPDATE OR DELETE ON lab_facility_licence
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- DOH reporting deadlines (interoperability) -------------------------------------------------------------------
-- The organization's own "report within N days of the diagnosis" per rule; a case report keeps the due time it got.
ALTER TABLE doh_reportable_rule ADD COLUMN report_within_days smallint CHECK (report_within_days BETWEEN 1 AND 365);
ALTER TABLE doh_case_report ADD COLUMN due_at timestamptz;

-- ---- Data Privacy Act: retention and records requests (documents, patient) ------------------------------------------
-- The organization's retention period per document category (from its own retention schedule). Nothing is ever
-- deleted by the platform: documents past the period are listed for review.
CREATE TABLE document_retention_policy (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  category         text        NOT NULL,
  retain_years     smallint    NOT NULL CHECK (retain_years BETWEEN 1 AND 100),
  basis_note       text        NOT NULL CHECK (length(btrim(basis_note)) BETWEEN 3 AND 500),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  ended_by         uuid        REFERENCES app_user (id),
  ended_at         timestamptz,
  CHECK ((status = 'inactive') = (ended_at IS NOT NULL)),
  CHECK ((ended_at IS NULL) = (ended_by IS NULL))
);
CREATE UNIQUE INDEX document_retention_policy_active ON document_retention_policy (organization_id, category) WHERE status = 'active';

-- The organization's records-request procedure: a response time, whether the requester's identity is confirmed before
-- sharing, and what patients read before asking.
CREATE TABLE records_request_setting (
  organization_id          uuid        PRIMARY KEY REFERENCES organization (id),
  response_days            smallint    CHECK (response_days BETWEEN 1 AND 365),
  identity_check_required  boolean     NOT NULL DEFAULT false,
  patient_notice           text        CHECK (length(btrim(patient_notice)) BETWEEN 10 AND 1500),
  updated_by               uuid        NOT NULL REFERENCES app_user (id),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  integer     NOT NULL DEFAULT 1 CHECK (version > 0)
);

ALTER TABLE records_request
  -- The response date the request got when submitted (from the organization's response time), if any.
  ADD COLUMN respond_by           date,
  ADD COLUMN identity_check_method text CHECK (length(btrim(identity_check_method)) BETWEEN 3 AND 200),
  ADD COLUMN identity_checked_by   uuid REFERENCES app_user (id),
  ADD COLUMN identity_checked_at   timestamptz,
  ADD CONSTRAINT records_request_identity_check
    CHECK ((identity_check_method IS NULL) = (identity_checked_by IS NULL) AND (identity_checked_by IS NULL) = (identity_checked_at IS NULL));

-- ---- Dental written estimates (dental) ----------------------------------------------------------------------------
ALTER TABLE dental_organization_setting
  -- How long a printed estimate holds (printed as "valid until"); null: no date printed.
  ADD COLUMN written_estimate_validity_days smallint CHECK (written_estimate_validity_days BETWEEN 1 AND 365),
  -- A decision recorded by staff needs a signed written estimate covering every item decided.
  ADD COLUMN written_estimate_required boolean NOT NULL DEFAULT false;

-- The patient signed a printed estimate: what it covered and totalled when printed, and until when it holds.
CREATE TABLE dental_written_estimate (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  plan_id          uuid        NOT NULL,
  patient_id       uuid        NOT NULL,
  -- The plan items awaiting a decision or accepted that the estimate listed.
  item_ids         uuid[]      NOT NULL CHECK (cardinality(item_ids) > 0),
  priced_on        date        NOT NULL,
  total_low        bigint      NOT NULL CHECK (total_low >= 0),
  total_high       bigint      NOT NULL CHECK (total_high >= total_low),
  unpriced_items   integer     NOT NULL DEFAULT 0 CHECK (unpriced_items >= 0),
  signed_on        date        NOT NULL,
  valid_until      date,
  recorded_by      uuid        NOT NULL REFERENCES app_user (id),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, plan_id) REFERENCES dental_treatment_plan (organization_id, id),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id),
  CHECK (signed_on >= priced_on),
  CHECK (valid_until IS NULL OR valid_until >= priced_on)
);
CREATE INDEX dental_written_estimate_plan ON dental_written_estimate (plan_id, recorded_at DESC);
CREATE TRIGGER dental_written_estimate_append_only BEFORE UPDATE OR DELETE ON dental_written_estimate
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- permissions --------------------------------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('compliance.review.manage', 'Record who validated each compliance area''s configuration against official requirements'),
  ('inventory.controlled-register.read', 'Read and export the register of controlled items'),
  ('document.retention.manage', 'Set document retention periods and review documents past them');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, p.key FROM role r
JOIN (VALUES
  ('org_admin', 'compliance.review.manage'),
  ('org_admin', 'inventory.controlled-register.read'),
  ('pharmacist', 'inventory.controlled-register.read'),
  ('inventory_officer', 'inventory.controlled-register.read'),
  ('org_admin', 'document.retention.manage'),
  ('records_officer', 'document.retention.manage')
) AS p (role_key, key) ON p.role_key = r.key
WHERE r.is_system
ON CONFLICT DO NOTHING;
