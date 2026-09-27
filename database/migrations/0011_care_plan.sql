-- Care plans (Phase 2). References to encounters, diagnoses and appointments use
-- (patient_id, id) foreign keys so they always belong to the same patient.
CREATE TABLE care_plan (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid        NOT NULL,
  patient_id                uuid        NOT NULL,
  title                     text        NOT NULL CHECK (length(btrim(title)) > 0),
  category                  text        NOT NULL CHECK (category IN ('chronic_disease', 'preventive', 'post_procedure', 'maternal', 'other')),
  description               text,
  status                    text        NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'on_hold', 'completed', 'cancelled')),
  start_date                date        NOT NULL,
  end_date                  date,
  author_practitioner_id    uuid,
  source_encounter_id       uuid,
  status_reason             text,
  created_by                uuid        NOT NULL REFERENCES app_user (id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid        NOT NULL REFERENCES app_user (id),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  version                   integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)             REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, author_practitioner_id) REFERENCES practitioner (organization_id, id),
  FOREIGN KEY (patient_id, source_encounter_id)         REFERENCES encounter (patient_id, id),
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (status NOT IN ('cancelled', 'on_hold') OR length(btrim(status_reason)) > 0)
);
CREATE INDEX care_plan_patient_idx ON care_plan (patient_id) WHERE status IN ('draft', 'active', 'on_hold');

-- Problems addressed by the plan: a recorded diagnosis or a free-text concern.
CREATE TABLE care_plan_problem (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id  uuid        NOT NULL REFERENCES care_plan (id),
  patient_id    uuid        NOT NULL,
  diagnosis_id  uuid,
  description   text        NOT NULL CHECK (length(btrim(description)) > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (patient_id, diagnosis_id) REFERENCES diagnosis (patient_id, id)
);

CREATE TABLE care_plan_goal (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id  uuid        NOT NULL REFERENCES care_plan (id),
  description   text        NOT NULL CHECK (length(btrim(description)) > 0),
  -- Clinician-set target, e.g. measure "HbA1c", target "< 7.0 %". Not interpreted by the platform.
  target_measure text,
  target_value  text,
  target_date   date,
  status        text        NOT NULL DEFAULT 'active' CHECK (status IN ('proposed', 'active', 'achieved', 'not_achieved', 'cancelled')),
  status_changed_at timestamptz,
  created_by    uuid        NOT NULL REFERENCES app_user (id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE care_plan_activity (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id              uuid        NOT NULL REFERENCES care_plan (id),
  organization_id           uuid        NOT NULL,
  patient_id                uuid        NOT NULL,
  goal_id                   uuid        REFERENCES care_plan_goal (id),
  kind                      text        NOT NULL CHECK (kind IN
                              ('follow_up_appointment', 'laboratory_monitoring', 'medication', 'lifestyle', 'education',
                               'referral', 'patient_task', 'provider_task')),
  description               text        NOT NULL CHECK (length(btrim(description)) > 0),
  assignee                  text        NOT NULL CHECK (assignee IN ('patient', 'care_team')),
  assignee_practitioner_id  uuid,
  due_date                  date,
  recurrence_interval_days  integer     CHECK (recurrence_interval_days BETWEEN 1 AND 730),
  status                    text        NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  linked_appointment_id     uuid,
  completed_at              timestamptz,
  completed_by              uuid        REFERENCES app_user (id),
  status_reason             text,
  created_by                uuid        NOT NULL REFERENCES app_user (id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, assignee_practitioner_id) REFERENCES practitioner (organization_id, id),
  FOREIGN KEY (patient_id, linked_appointment_id)         REFERENCES appointment (patient_id, id),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CHECK (status <> 'scheduled' OR linked_appointment_id IS NOT NULL),
  CHECK (status <> 'cancelled' OR length(btrim(status_reason)) > 0)
);
CREATE INDEX care_plan_activity_due_idx ON care_plan_activity (organization_id, due_date) WHERE status IN ('planned', 'scheduled', 'in_progress');

CREATE TABLE care_plan_progress_note (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id  uuid        NOT NULL REFERENCES care_plan (id),
  note          text        NOT NULL CHECK (length(btrim(note)) > 0),
  recorded_by   uuid        NOT NULL REFERENCES app_user (id),
  recorded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER care_plan_progress_note_append_only BEFORE UPDATE OR DELETE ON care_plan_progress_note
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
