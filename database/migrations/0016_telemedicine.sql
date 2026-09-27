-- Telemedicine (Phase 5). See docs/domains/telemedicine.md.
--
-- An online consultation is an appointment whose visit type has modality 'telemedicine'. The patient
-- answers a pre-consult questionnaire and joins a waiting room from MyHealth (which checks the visit in
-- without staff), the clinician starts a telemedicine encounter (same encounter model as in person) and
-- joins the video room, and can escalate to in-person care at any time.

-- Patients check themselves in to online visits from the portal: no staff user is involved.
ALTER TABLE visit ALTER COLUMN checked_in_by DROP NOT NULL;
ALTER TABLE visit ADD COLUMN checked_in_via text NOT NULL DEFAULT 'staff' CHECK (checked_in_via IN ('staff', 'patient_portal'));
ALTER TABLE visit ADD CONSTRAINT visit_checked_in_by_staff CHECK ((checked_in_via = 'staff') = (checked_in_by IS NOT NULL));

CREATE TABLE telemedicine_session (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid        NOT NULL,
  facility_id                 uuid        NOT NULL,
  patient_id                  uuid        NOT NULL,
  appointment_id              uuid        NOT NULL UNIQUE,
  visit_id                    uuid        UNIQUE,
  encounter_id                uuid        UNIQUE,
  -- Opaque video room name (no patient data): the provider sees only this.
  room_name                   text        NOT NULL UNIQUE CHECK (room_name ~ '^tm-[0-9a-f]{32}$'),
  status                      text        NOT NULL DEFAULT 'scheduled'
                                CHECK (status IN ('scheduled', 'waiting', 'in_consultation', 'ended', 'escalated')),
  -- Pre-consult questionnaire (a configurable form, versioned in the payload).
  questionnaire               jsonb,
  questionnaire_submitted_at  timestamptz,
  red_flags                   text[]      NOT NULL DEFAULT '{}',
  -- The patient's electronic acknowledgement of an online consultation, captured with the questionnaire.
  consent_acknowledged_at     timestamptz,
  patient_joined_at           timestamptz,
  clinician_joined_at         timestamptz,
  started_at                  timestamptz,
  started_by                  uuid        REFERENCES app_user (id),
  ended_at                    timestamptz,
  ended_by                    uuid        REFERENCES app_user (id),
  escalation_reason           text,
  -- What the patient should do next, shown in MyHealth after the consultation.
  patient_instructions        text,
  instructions_updated_at     timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  version                     integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)  REFERENCES patient (organization_id, id),
  FOREIGN KEY (patient_id, appointment_id)   REFERENCES appointment (patient_id, id),
  FOREIGN KEY (patient_id, visit_id)         REFERENCES visit (patient_id, id),
  FOREIGN KEY (patient_id, encounter_id)     REFERENCES encounter (patient_id, id),
  CHECK ((questionnaire IS NULL) = (questionnaire_submitted_at IS NULL)),
  CHECK (status = 'scheduled' OR (visit_id IS NOT NULL AND patient_joined_at IS NOT NULL)),
  CHECK (status NOT IN ('in_consultation', 'ended', 'escalated') OR (encounter_id IS NOT NULL AND started_at IS NOT NULL)),
  CHECK ((status IN ('ended', 'escalated')) = (ended_at IS NOT NULL)),
  CHECK ((status = 'escalated') = (length(btrim(escalation_reason)) > 0 AND escalation_reason IS NOT NULL)),
  CHECK ((patient_instructions IS NULL) = (instructions_updated_at IS NULL))
);
CREATE INDEX telemedicine_session_facility_idx ON telemedicine_session (facility_id, status);

INSERT INTO permission (key, description) VALUES
  ('telemedicine.read',    'View the online consultation queue and pre-consult questionnaires'),
  ('telemedicine.conduct', 'Start, join, end and escalate online consultations');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, p.key FROM role r CROSS JOIN permission p
WHERE r.key = 'org_admin' AND r.is_system
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('physician', 'telemedicine.read'), ('physician', 'telemedicine.conduct'),
  ('nurse', 'telemedicine.read'),
  ('receptionist', 'telemedicine.read')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system;
