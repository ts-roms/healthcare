-- MyHealth dental: released images and online plan decisions. See docs/domains/dental.md ("Dental records in MyHealth").
--
-- 1. Images: a dentist releases an image to the patient explicitly (and can withdraw it). Releases are history: one
--    active release per image, a withdrawal ends it (who, when, why), nothing is deleted. Patients see released images
--    that are not entered in error, only while the organization shares dental records, through short-lived signed links.
-- 2. Plan decisions: when the organization also turns this on (off by default) and writes its own acknowledgement text,
--    a patient can accept or decline the items of a plan awaiting their decision in MyHealth, after confirming that
--    text. The plan records the channel ("portal") and the portal account; the acknowledgement is kept as the decision
--    note. No consent wording is supplied by the platform: written informed-consent requirements for dental treatment
--    are a compliance dependency the organization validates.

-- ---- settings ---------------------------------------------------------------------------------------

ALTER TABLE dental_organization_setting
  ADD COLUMN portal_plan_decisions      boolean NOT NULL DEFAULT false,
  ADD COLUMN portal_plan_acknowledgement text   CHECK (length(btrim(portal_plan_acknowledgement)) BETWEEN 20 AND 1000),
  ADD CONSTRAINT dental_organization_setting_decisions_need_records
    CHECK (NOT portal_plan_decisions OR (portal_dental_records AND portal_plan_acknowledgement IS NOT NULL));

-- ---- plan decisions ---------------------------------------------------------------------------------

ALTER TABLE dental_treatment_plan
  ADD COLUMN decision_channel          text CHECK (decision_channel IN ('in_person', 'portal')),
  ADD COLUMN decided_by_portal_account uuid,
  ADD CONSTRAINT dental_treatment_plan_portal_account
    FOREIGN KEY (organization_id, decided_by_portal_account) REFERENCES patient_portal_account (organization_id, id);

UPDATE dental_treatment_plan SET decision_channel = 'in_person' WHERE decided_at IS NOT NULL;

ALTER TABLE dental_treatment_plan DROP CONSTRAINT dental_treatment_plan_check1;
ALTER TABLE dental_treatment_plan ADD CONSTRAINT dental_treatment_plan_decided_by CHECK (
  decided_at IS NULL
  OR (
    length(btrim(decision_note)) > 0
    AND (
      (decision_channel = 'in_person' AND decided_by IS NOT NULL AND decided_by_portal_account IS NULL)
      OR (decision_channel = 'portal' AND decided_by IS NULL AND decided_by_portal_account IS NOT NULL)
    )
  )
);

-- ---- image releases ---------------------------------------------------------------------------------

CREATE TABLE dental_image_release (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  image_id         uuid        NOT NULL,
  released_by      uuid        NOT NULL REFERENCES app_user (id),
  released_at      timestamptz NOT NULL DEFAULT now(),
  withdrawn_by     uuid        REFERENCES app_user (id),
  withdrawn_at     timestamptz,
  withdraw_reason  text        CHECK (length(btrim(withdraw_reason)) BETWEEN 5 AND 500),
  FOREIGN KEY (organization_id, image_id) REFERENCES dental_image (organization_id, id),
  CHECK ((withdrawn_at IS NULL) = (withdrawn_by IS NULL)),
  CHECK ((withdrawn_at IS NULL) = (withdraw_reason IS NULL)),
  CHECK (withdrawn_at IS NULL OR withdrawn_at >= released_at)
);
-- One active release per image.
CREATE UNIQUE INDEX dental_image_release_active ON dental_image_release (image_id) WHERE withdrawn_at IS NULL;

CREATE FUNCTION dental_image_release_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'image releases are not deleted' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF OLD.withdrawn_at IS NOT NULL
     OR (NEW.id, NEW.organization_id, NEW.image_id, NEW.released_by, NEW.released_at)
        IS DISTINCT FROM (OLD.id, OLD.organization_id, OLD.image_id, OLD.released_by, OLD.released_at) THEN
    RAISE EXCEPTION 'an image release only changes when it is withdrawn, once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dental_image_release_history BEFORE UPDATE OR DELETE ON dental_image_release
  FOR EACH ROW EXECUTE FUNCTION dental_image_release_guard();

-- ---- permissions ------------------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('dental.imaging.release', 'Share dental images with the patient in MyHealth, and withdraw them');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'dental.imaging.release' FROM role r
WHERE r.key IN ('org_admin', 'dentist') AND r.is_system
ON CONFLICT DO NOTHING;
