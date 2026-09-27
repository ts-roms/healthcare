-- PhilHealth eligibility: adapter stubs (Phase 8). See docs/interoperability/philhealth-eligibility.md.
--
-- No official PhilHealth eligibility specification is on record: nothing here models PhilHealth's inquiry format,
-- result codes, membership categories or eligibility rules. What the platform keeps is the record of each check —
-- who checked, for which patient and date of service, what PhilHealth answered and its reference — whether staff
-- checked through PhilHealth's own channel or an adapter did (via the integration worker).

CREATE TABLE philhealth_eligibility_check (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL REFERENCES organization (id),
  facility_id         uuid        NOT NULL,
  patient_id          uuid        NOT NULL,
  service_date        date        NOT NULL,
  -- queued: waiting for the adapter. The others are PhilHealth's answer as the platform records it.
  status              text        NOT NULL CHECK (status IN ('queued', 'eligible', 'not_eligible', 'undetermined', 'failed')),
  source              text        NOT NULL CHECK (source IN ('external_channel', 'adapter')),
  external_reference  text        CHECK (length(external_reference) <= 80),
  -- Staff note (manual records) or the reason codes an adapter returned; no clinical text.
  note                text        CHECK (length(note) <= 500),
  outcome_detail      jsonb       NOT NULL DEFAULT '{}',
  exchange_id         uuid        REFERENCES integration_exchange (id),
  requested_by        uuid        NOT NULL REFERENCES app_user (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)  REFERENCES patient (organization_id, id),
  CHECK ((status = 'queued') = (completed_at IS NULL)),
  CHECK (source = 'adapter' OR (status <> 'queued' AND external_reference IS NOT NULL)),
  CHECK ((source = 'adapter') = (exchange_id IS NOT NULL))
);
CREATE INDEX philhealth_eligibility_patient ON philhealth_eligibility_check (organization_id, patient_id, service_date DESC, created_at DESC);

-- A recorded answer is history: only a queued check may change (to its answer), and nothing is deleted.
CREATE FUNCTION philhealth_eligibility_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'eligibility checks are not deleted' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status <> 'queued' THEN RAISE EXCEPTION 'a recorded eligibility answer cannot change' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.patient_id <> OLD.patient_id OR NEW.service_date <> OLD.service_date OR NEW.source <> OLD.source OR NEW.facility_id <> OLD.facility_id THEN
    RAISE EXCEPTION 'only the answer of a queued eligibility check may be recorded' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER philhealth_eligibility_immutable BEFORE UPDATE OR DELETE ON philhealth_eligibility_check
  FOR EACH ROW EXECUTE FUNCTION philhealth_eligibility_guard();

-- ---- permissions --------------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('philhealth.eligibility.manage', 'View and record PhilHealth eligibility checks, and request them through an adapter');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'philhealth.eligibility.manage' FROM role r
WHERE r.key IN ('org_admin', 'receptionist', 'cashier') AND r.is_system
ON CONFLICT DO NOTHING;
