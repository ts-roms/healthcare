-- Kiosk phase 5: ticket printing, display devices and the waiting-room display's own settings
-- (docs/domains/kiosk.md, "Printing and devices").
--
-- A kiosk ticket is printed by a small local print agent that PULLS jobs from the API (it opens no inbound port beyond a
-- localhost health check). The job holds only what is on the ticket: its number, the service, the facility, the time and a
-- plain instruction, never a patient. Reprinting is a staff decision with a reason and a limit.

-- ---- 1. Permissions and the print agent's role ------------------------------------------------------------------------

INSERT INTO permission (key, description) VALUES
  ('kiosk.print.agent',   'Act as a kiosk print agent: claim ticket print jobs of the facility and report their result and the printer''s state'),
  ('kiosk.print.reprint', 'Print a kiosk ticket again, with a reason');

INSERT INTO role (key, name, description, is_system) VALUES
  ('kiosk_print_agent', 'Kiosk print agent', 'For the local service that prints kiosk tickets: claims and reports print jobs only, no patient records', true);

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('kiosk_print_agent', 'kiosk.print.agent'),
  ('receptionist',      'kiosk.print.reprint'),
  ('org_admin',         'kiosk.print.reprint')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system
ON CONFLICT DO NOTHING;

-- ---- 2. Devices: kiosks and waiting-room displays, and when the printer last reported ----------------------------------

ALTER TABLE kiosk_device ADD COLUMN kind text NOT NULL DEFAULT 'kiosk' CHECK (kind IN ('kiosk', 'display'));
ALTER TABLE kiosk_device ADD COLUMN printer_heartbeat_at timestamptz;

-- ---- 3. Print jobs ---------------------------------------------------------------------------------------------------

CREATE TABLE kiosk_print_job (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  facility_id      uuid        NOT NULL,
  -- The kiosk whose printer prints it.
  device_id        uuid        NOT NULL,
  visit_id         uuid        NOT NULL,
  kind             text        NOT NULL DEFAULT 'ticket' CHECK (kind = 'ticket'),
  -- What is printed: nothing about the patient.
  ticket           text        NOT NULL CHECK (ticket ~ '^[A-Z]-[0-9]{3,}$'),
  service_name     text        NOT NULL CHECK (length(btrim(service_name)) BETWEEN 1 AND 100),
  facility_name    text        NOT NULL CHECK (length(btrim(facility_name)) BETWEEN 1 AND 200),
  issued_at        timestamptz NOT NULL,
  instructions     text        NOT NULL CHECK (length(btrim(instructions)) BETWEEN 1 AND 300),
  status           text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'printing', 'printed', 'failed', 'cancelled')),
  attempts         integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- While `printing`, the agent holds the job until this time; after it the job may be claimed again.
  lease_expires_at timestamptz,
  -- A short code (paper_out, offline, error), never a stack trace or a printer's raw answer.
  last_error       text        CHECK (last_error ~ '^[a-z_]{2,40}$'),
  printed_at       timestamptz,
  -- A reprint points to the job it repeats and records who asked and why.
  reprint_of       uuid,
  reprint_reason   text        CHECK (reprint_reason IS NULL OR length(btrim(reprint_reason)) BETWEEN 5 AND 500),
  requested_by     uuid        REFERENCES app_user (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, device_id)   REFERENCES kiosk_device (organization_id, id),
  FOREIGN KEY (organization_id, visit_id)    REFERENCES visit (organization_id, id),
  FOREIGN KEY (organization_id, reprint_of)  REFERENCES kiosk_print_job (organization_id, id),
  CHECK ((reprint_of IS NULL) = (reprint_reason IS NULL AND requested_by IS NULL)),
  CHECK ((status = 'printed') = (printed_at IS NOT NULL)),
  CHECK (status <> 'printing' OR lease_expires_at IS NOT NULL)
);
-- A ticket is queued for printing once per visit; a retry of the check-in cannot print it twice.
CREATE UNIQUE INDEX kiosk_print_job_original_uq ON kiosk_print_job (visit_id) WHERE reprint_of IS NULL;
CREATE INDEX kiosk_print_job_queue_idx ON kiosk_print_job (organization_id, device_id, status, created_at);
CREATE INDEX kiosk_print_job_reprint_idx ON kiosk_print_job (reprint_of) WHERE reprint_of IS NOT NULL;

-- What was printed never changes; a job only moves forward (queued -> printing -> printed | failed, or back to queued for a
-- retry while attempts remain) or is cancelled while it still waits.
CREATE FUNCTION kiosk_print_job_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
     OR NEW.device_id IS DISTINCT FROM OLD.device_id OR NEW.visit_id IS DISTINCT FROM OLD.visit_id
     OR NEW.ticket IS DISTINCT FROM OLD.ticket OR NEW.service_name IS DISTINCT FROM OLD.service_name
     OR NEW.facility_name IS DISTINCT FROM OLD.facility_name OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.instructions IS DISTINCT FROM OLD.instructions OR NEW.reprint_of IS DISTINCT FROM OLD.reprint_of
     OR NEW.reprint_reason IS DISTINCT FROM OLD.reprint_reason OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A print job''s content is fixed' USING ERRCODE = 'KP001';
  END IF;
  IF OLD.status IN ('printed', 'failed', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'A finished print job does not change' USING ERRCODE = 'KP001';
  END IF;
  IF OLD.status = 'queued' AND NEW.status NOT IN ('queued', 'printing', 'cancelled') THEN
    RAISE EXCEPTION 'A waiting print job is claimed or cancelled' USING ERRCODE = 'KP001';
  END IF;
  IF OLD.status = 'printing' AND NEW.status NOT IN ('printing', 'queued', 'printed', 'failed') THEN
    RAISE EXCEPTION 'A claimed print job is printed, failed or released' USING ERRCODE = 'KP001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kiosk_print_job_guard BEFORE UPDATE ON kiosk_print_job FOR EACH ROW EXECUTE FUNCTION kiosk_print_job_guard();
CREATE TRIGGER kiosk_print_job_no_delete BEFORE DELETE ON kiosk_print_job FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---- 4. The waiting-room display's own settings ------------------------------------------------------------------------
-- Per facility: a headline and a footer line in the facility's own words, an accent colour, and whether the screen groups
-- the calls it shows by service point (department). None of it is patient data.

CREATE TABLE queue_display_setting (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid        NOT NULL REFERENCES organization (id),
  facility_id               uuid        NOT NULL,
  headline                  text        CHECK (headline IS NULL OR length(btrim(headline)) BETWEEN 1 AND 80),
  footer_message            text        CHECK (footer_message IS NULL OR length(btrim(footer_message)) BETWEEN 1 AND 160),
  accent_color              text        CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  group_by_service_point    boolean     NOT NULL DEFAULT false,
  updated_by                uuid        NOT NULL REFERENCES app_user (id),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  version                   integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, facility_id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id)
);
