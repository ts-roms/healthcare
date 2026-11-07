-- Patient self-service kiosk (docs/domains/kiosk.md, ADR-0015).
--
-- A kiosk is an unattended touchscreen in the waiting area. It signs in as a staff account that holds only the
-- `kiosk_device` role (the pattern of the waiting-room display, migration 0112) and is registered here as a device of one
-- facility. A patient at the kiosk is served in a short-lived kiosk session; identity is checked against the Patient
-- Master, never trusted from the screen. Walk-in and appointment check-ins go through the clinic's ordinary visit code
-- (same ticket counter, same one-active-visit-per-patient rule); a new patient's registration is staged here and becomes a
-- patient only when a member of staff approves it.

-- ---- 1. Permissions and the device role -----------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('kiosk.session.use',         'Act as a patient self-service kiosk: open patient sessions, identify, submit a registration, check in and take a ticket'),
  ('kiosk.device.read',         'See the facility''s kiosks and whether they are online'),
  ('kiosk.device.manage',       'Register, rename, put into maintenance or disable kiosks'),
  ('kiosk.registration.review', 'Review registrations submitted at a kiosk: approve, link to an existing patient, or reject');

INSERT INTO role (key, name, description, is_system) VALUES
  ('kiosk_device', 'Patient kiosk', 'For a self-service kiosk in the waiting area: sessions, identification and check-in only, no patient records', true);

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('kiosk_device', 'kiosk.session.use'),
  ('receptionist', 'kiosk.device.read'),
  ('receptionist', 'kiosk.registration.review'),
  ('org_admin',    'kiosk.device.read'),
  ('org_admin',    'kiosk.device.manage'),
  ('org_admin',    'kiosk.registration.review')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system
ON CONFLICT DO NOTHING;

-- ---- 2. Devices -----------------------------------------------------------------------------------------------------

CREATE TABLE kiosk_device (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  facility_id      uuid        NOT NULL,
  -- Appears in the kiosk's address; it routes the page and is NOT a credential (the device's sign-in is).
  code             text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  name             text        NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 100),
  -- The staff account the kiosk signs in with: one device per account.
  user_id          uuid        NOT NULL REFERENCES app_user (id),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'disabled')),
  heartbeat_at     timestamptz,
  app_version      text        CHECK (length(app_version) <= 40),
  printer_status   text        NOT NULL DEFAULT 'unknown' CHECK (printer_status IN ('unknown', 'none', 'ok', 'paper_out', 'offline', 'error')),
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, facility_id, code),
  UNIQUE (user_id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id)
);
CREATE INDEX kiosk_device_facility_idx ON kiosk_device (organization_id, facility_id);

-- ---- 3. Patient sessions --------------------------------------------------------------------------------------------
-- One person's time at a kiosk. The token the screen holds is random and stored only as a hash. Nothing identifying is
-- kept here beyond the patient id once identity is confirmed; rows are not deleted (they show how a ticket came to be).

CREATE TABLE kiosk_session (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  facility_id      uuid        NOT NULL,
  device_id        uuid        NOT NULL,
  token_hash       text        NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'expired', 'locked')),
  -- Set once the person was matched in the Patient Master and answered the second check.
  patient_id       uuid,
  identified_at    timestamptz,
  failed_attempts  integer     NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  ended_at         timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, device_id)   REFERENCES kiosk_device (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)  REFERENCES patient (organization_id, id),
  CHECK ((patient_id IS NULL) = (identified_at IS NULL)),
  CHECK ((status = 'active') = (ended_at IS NULL))
);
CREATE INDEX kiosk_session_device_idx ON kiosk_session (device_id, created_at DESC);
CREATE INDEX kiosk_session_open_idx ON kiosk_session (expires_at) WHERE status = 'active';

-- ---- 4. Registrations waiting for staff -----------------------------------------------------------------------------
-- What a new patient typed. It holds personal data, so it is sealed with the platform key ring, readable only to the
-- reviewing role, and erased (payload set to null) the moment a decision is recorded or the submission lapses.

CREATE TABLE kiosk_registration (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL REFERENCES organization (id),
  facility_id           uuid        NOT NULL,
  device_id             uuid        NOT NULL,
  session_id            uuid        NOT NULL,
  -- Shown to the person at the kiosk and read out at the desk; meaningless on its own.
  reference             text        NOT NULL CHECK (reference ~ '^KR-[A-HJ-NP-Z2-9]{6}$'),
  status                text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'linked', 'rejected', 'expired')),
  payload_sealed        text,
  payload_key_id        text,
  -- Existing patients the Patient Master considered the same person, found at submission (ids only).
  duplicate_candidate_ids uuid[]    NOT NULL DEFAULT '{}',
  submitted_at          timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  reviewed_by           uuid        REFERENCES app_user (id),
  reviewed_at           timestamptz,
  decision_reason       text        CHECK (length(btrim(decision_reason)) BETWEEN 5 AND 500),
  patient_id            uuid,
  visit_id              uuid,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, reference),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, device_id)   REFERENCES kiosk_device (organization_id, id),
  FOREIGN KEY (organization_id, session_id)  REFERENCES kiosk_session (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)  REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, visit_id)    REFERENCES visit (organization_id, id),
  CHECK ((payload_sealed IS NULL) = (payload_key_id IS NULL)),
  -- Pending: the payload is held. Anything else: it has been erased.
  CHECK ((status = 'pending') = (payload_sealed IS NOT NULL)),
  CHECK ((status IN ('approved', 'linked', 'rejected')) = (reviewed_at IS NOT NULL)),
  CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL)),
  CHECK (status NOT IN ('approved', 'linked') OR patient_id IS NOT NULL),
  CHECK (status <> 'rejected' OR decision_reason IS NOT NULL)
);
-- One submission per session: a retry or a second tap cannot create two.
CREATE UNIQUE INDEX kiosk_registration_session_uq ON kiosk_registration (session_id);
CREATE INDEX kiosk_registration_pending_idx ON kiosk_registration (organization_id, facility_id, submitted_at) WHERE status = 'pending';
CREATE INDEX kiosk_registration_expiry_idx ON kiosk_registration (expires_at) WHERE status = 'pending';

-- A decision is final: once a registration leaves "pending" nothing about it changes.
CREATE FUNCTION kiosk_registration_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'kiosk_registration rows are not deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'a decided kiosk registration cannot change' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kiosk_registration_guard BEFORE UPDATE OR DELETE ON kiosk_registration
  FOR EACH ROW EXECUTE FUNCTION kiosk_registration_guard();

-- The organization chooses which of its visit types a kiosk offers (a walk-in type the front desk would rather handle
-- itself, such as an emergency, simply stays off).
ALTER TABLE visit_type ADD COLUMN kiosk_enabled boolean NOT NULL DEFAULT false;

-- ---- 5. The clinic's queue: a kiosk origin and a way back into the line ---------------------------------------------

ALTER TABLE visit DROP CONSTRAINT visit_checked_in_via_check;
ALTER TABLE visit ADD CONSTRAINT visit_checked_in_via_check CHECK (checked_in_via IN ('staff', 'patient_portal', 'kiosk'));
-- A kiosk check-in, like one in MyHealth, has no staff user: only 'staff' check-ins name one (visit_checked_in_by_staff).

-- A patient who was called and did not come forward goes back into the line behind those who arrived since (same
-- priority). queued_at is the time the queue orders by; it is checked_in_at until the visit is skipped. The arrival
-- time itself never changes, so waiting-time figures stay true.
ALTER TABLE visit ADD COLUMN queued_at timestamptz;
ALTER TABLE visit ADD COLUMN skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0);
