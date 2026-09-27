-- Clinic / EMR (Phase 2). See libs/clinic/CLAUDE.md.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE practitioner (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid        NOT NULL REFERENCES organization (id),
  user_id              uuid        REFERENCES app_user (id),
  display_name         text        NOT NULL CHECK (length(btrim(display_name)) > 0),
  profession           text        NOT NULL CHECK (profession IN
                         ('physician', 'dentist', 'nurse', 'midwife', 'medical_technologist', 'pharmacist', 'other')),
  specialty            text,
  -- PRC license: recorded for reference; validity is not verified by the platform.
  license_number       text,
  license_valid_until  date,
  status               text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE room (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  facility_id      uuid        NOT NULL,
  code             text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{0,48}$'),
  name             text        NOT NULL CHECK (length(btrim(name)) > 0),
  room_type        text        NOT NULL CHECK (room_type IN ('consultation', 'triage', 'procedure', 'dental', 'other')),
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  UNIQUE (facility_id, code),
  UNIQUE (organization_id, id)
);

CREATE TABLE visit_type (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid        NOT NULL REFERENCES organization (id),
  code                      text        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name                      text        NOT NULL CHECK (length(btrim(name)) > 0),
  default_duration_minutes  integer     NOT NULL CHECK (default_duration_minutes BETWEEN 5 AND 480),
  modality                  text        NOT NULL DEFAULT 'in_person' CHECK (modality IN ('in_person', 'telemedicine')),
  requires_triage           boolean     NOT NULL DEFAULT true,
  status                    text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id)
);

-- Diagnosis coding systems are configuration (e.g. an organization's ICD-10 edition), not schema.
CREATE TABLE coding_system (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organization (id),
  key              text        NOT NULL CHECK (key ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  name             text        NOT NULL,
  version          text,
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key)
);

-- Weekly recurring availability of a practitioner at a facility (local facility time).
CREATE TABLE practitioner_schedule (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  practitioner_id  uuid        NOT NULL,
  facility_id      uuid        NOT NULL,
  room_id          uuid,
  day_of_week      smallint    NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday
  start_time       time        NOT NULL,
  end_time         time        NOT NULL,
  slot_minutes     integer     NOT NULL CHECK (slot_minutes BETWEEN 5 AND 240),
  valid_from       date        NOT NULL,
  valid_until      date,
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  retired_at       timestamptz,
  FOREIGN KEY (organization_id, practitioner_id) REFERENCES practitioner (organization_id, id),
  FOREIGN KEY (organization_id, facility_id)     REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, room_id)         REFERENCES room (organization_id, id),
  CHECK (end_time > start_time),
  CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);
CREATE INDEX practitioner_schedule_lookup_idx ON practitioner_schedule (practitioner_id, facility_id) WHERE status = 'active';

-- Unavailability: a practitioner's leave, or a whole-facility closure (practitioner NULL),
-- e.g. a declared holiday. Holidays are configured, never hard-coded.
CREATE TABLE schedule_exception (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  facility_id      uuid        NOT NULL,
  practitioner_id  uuid,
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  reason           text        NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, facility_id)     REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, practitioner_id) REFERENCES practitioner (organization_id, id),
  CHECK (ends_at > starts_at)
);
CREATE INDEX schedule_exception_range_idx ON schedule_exception USING gist (facility_id, tstzrange(starts_at, ends_at));

CREATE TABLE appointment (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid        NOT NULL,
  facility_id          uuid        NOT NULL,
  patient_id           uuid        NOT NULL,
  practitioner_id      uuid        NOT NULL,
  room_id              uuid,
  visit_type_id        uuid        NOT NULL,
  starts_at            timestamptz NOT NULL,
  ends_at              timestamptz NOT NULL,
  status               text        NOT NULL DEFAULT 'booked' CHECK (status IN
                         ('booked', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show')),
  booking_channel      text        NOT NULL CHECK (booking_channel IN ('front_desk', 'phone', 'online', 'follow_up')),
  reason               text        CHECK (length(reason) <= 500),
  notes                text,
  series_id            uuid,
  confirmed_at         timestamptz,
  checked_in_at        timestamptz,
  completed_at         timestamptz,
  no_show_at           timestamptz,
  cancelled_at         timestamptz,
  cancelled_by         uuid        REFERENCES app_user (id),
  cancellation_reason  text,
  created_by           uuid        NOT NULL REFERENCES app_user (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid        NOT NULL REFERENCES app_user (id),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (patient_id, id),
  FOREIGN KEY (organization_id, facility_id)     REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)      REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, practitioner_id) REFERENCES practitioner (organization_id, id),
  FOREIGN KEY (organization_id, room_id)         REFERENCES room (organization_id, id),
  FOREIGN KEY (organization_id, visit_type_id)   REFERENCES visit_type (organization_id, id),
  CHECK (ends_at > starts_at),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK (cancelled_at IS NULL OR length(btrim(cancellation_reason)) > 0),
  CHECK ((status = 'no_show') = (no_show_at IS NOT NULL)),
  -- No double-booking of a practitioner or a room (CLAUDE.md: enforced by the database).
  CONSTRAINT appointment_practitioner_no_overlap EXCLUDE USING gist
    (practitioner_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status NOT IN ('cancelled', 'no_show')),
  CONSTRAINT appointment_room_no_overlap EXCLUDE USING gist
    (room_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (room_id IS NOT NULL AND status NOT IN ('cancelled', 'no_show'))
);
CREATE INDEX appointment_facility_day_idx ON appointment (facility_id, starts_at);
CREATE INDEX appointment_patient_idx ON appointment (patient_id, starts_at DESC);

CREATE TABLE appointment_waitlist_entry (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  facility_id      uuid        NOT NULL,
  patient_id       uuid        NOT NULL,
  practitioner_id  uuid,
  visit_type_id    uuid,
  earliest_date    date        NOT NULL,
  latest_date      date        NOT NULL,
  priority         text        NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine', 'soon')),
  notes            text,
  status           text        NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'booked', 'cancelled')),
  appointment_id   uuid,
  created_by       uuid        NOT NULL REFERENCES app_user (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz,
  closed_by        uuid        REFERENCES app_user (id),
  close_reason     text,
  FOREIGN KEY (organization_id, facility_id)     REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)      REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, practitioner_id) REFERENCES practitioner (organization_id, id),
  FOREIGN KEY (organization_id, visit_type_id)   REFERENCES visit_type (organization_id, id),
  FOREIGN KEY (patient_id, appointment_id)       REFERENCES appointment (patient_id, id),
  CHECK (latest_date >= earliest_date),
  CHECK ((status = 'booked') = (appointment_id IS NOT NULL)),
  CHECK ((status = 'waiting') = (closed_at IS NULL))
);

-- A visit is one arrival at a facility; it is the queue entry (CLAUDE.md "QueueEntry").
CREATE TABLE facility_queue_counter (
  facility_id  uuid    NOT NULL REFERENCES facility (id),
  queue_date   date    NOT NULL,
  next_value   integer NOT NULL CHECK (next_value > 0),
  PRIMARY KEY (facility_id, queue_date)
);

CREATE TABLE visit (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL,
  facility_id              uuid        NOT NULL,
  patient_id               uuid        NOT NULL,
  appointment_id           uuid        UNIQUE,
  visit_type_id            uuid        NOT NULL,
  arrival_mode             text        NOT NULL CHECK (arrival_mode IN ('walk_in', 'appointment')),
  queue_date               date        NOT NULL,
  queue_number             integer     NOT NULL CHECK (queue_number > 0),
  priority                 text        NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine', 'urgent', 'emergency')),
  status                   text        NOT NULL DEFAULT 'waiting' CHECK (status IN
                             ('waiting', 'in_triage', 'awaiting_consultation', 'in_consultation', 'completed', 'cancelled', 'left_without_being_seen')),
  assigned_practitioner_id uuid,
  chief_complaint          text,
  checked_in_at            timestamptz NOT NULL DEFAULT now(),
  checked_in_by            uuid        NOT NULL REFERENCES app_user (id),
  called_at                timestamptz,
  called_to                text,
  triage_started_at        timestamptz,
  consultation_started_at  timestamptz,
  completed_at             timestamptz,
  closed_reason            text,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (patient_id, id),
  UNIQUE (facility_id, queue_date, queue_number),
  FOREIGN KEY (organization_id, facility_id)              REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)               REFERENCES patient (organization_id, id),
  FOREIGN KEY (patient_id, appointment_id)                REFERENCES appointment (patient_id, id),
  FOREIGN KEY (organization_id, visit_type_id)            REFERENCES visit_type (organization_id, id),
  FOREIGN KEY (organization_id, assigned_practitioner_id) REFERENCES practitioner (organization_id, id),
  CHECK ((arrival_mode = 'appointment') = (appointment_id IS NOT NULL)),
  CHECK (status NOT IN ('cancelled', 'left_without_being_seen') OR length(btrim(closed_reason)) > 0),
  CHECK (status NOT IN ('completed', 'cancelled', 'left_without_being_seen') OR completed_at IS NOT NULL)
);
-- A patient cannot be in the same facility's queue twice at once.
CREATE UNIQUE INDEX visit_patient_active_uq ON visit (facility_id, patient_id)
  WHERE status IN ('waiting', 'in_triage', 'awaiting_consultation', 'in_consultation');
CREATE INDEX visit_queue_idx ON visit (facility_id, queue_date, status);

CREATE TABLE triage_assessment (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL,
  visit_id                 uuid        NOT NULL,
  patient_id               uuid        NOT NULL,
  chief_complaint          text        NOT NULL CHECK (length(btrim(chief_complaint)) > 0),
  pain_score               smallint    CHECK (pain_score BETWEEN 0 AND 10),
  priority                 text        NOT NULL CHECK (priority IN ('routine', 'urgent', 'emergency')),
  risk_flags               text[]      NOT NULL DEFAULT '{}',
  notes                    text,
  assessed_by              uuid        NOT NULL REFERENCES app_user (id),
  assessed_at              timestamptz NOT NULL DEFAULT now(),
  status                   text        NOT NULL DEFAULT 'final' CHECK (status IN ('final', 'entered_in_error')),
  entered_in_error_reason  text,
  entered_in_error_by      uuid        REFERENCES app_user (id),
  FOREIGN KEY (patient_id, visit_id) REFERENCES visit (patient_id, id),
  CHECK ((status = 'entered_in_error') = (entered_in_error_reason IS NOT NULL))
);
CREATE INDEX triage_assessment_visit_idx ON triage_assessment (visit_id);

-- One row per set of measurements; corrections mark the row entered-in-error, never delete it.
CREATE TABLE vital_sign_set (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL,
  facility_id              uuid,
  patient_id               uuid        NOT NULL,
  visit_id                 uuid,
  encounter_id             uuid,
  measured_at              timestamptz NOT NULL,
  measured_by              uuid        NOT NULL REFERENCES app_user (id),
  systolic_mmhg            smallint    CHECK (systolic_mmhg > 0),
  diastolic_mmhg           smallint    CHECK (diastolic_mmhg > 0),
  heart_rate_bpm           smallint    CHECK (heart_rate_bpm > 0),
  respiratory_rate_bpm     smallint    CHECK (respiratory_rate_bpm > 0),
  temperature_c            numeric(4,1) CHECK (temperature_c > 0),
  spo2_percent             smallint    CHECK (spo2_percent BETWEEN 1 AND 100),
  weight_kg                numeric(5,2) CHECK (weight_kg > 0),
  height_cm                numeric(5,1) CHECK (height_cm > 0),
  blood_glucose_mg_dl      smallint    CHECK (blood_glucose_mg_dl > 0),
  notes                    text,
  recorded_at              timestamptz NOT NULL DEFAULT now(),
  status                   text        NOT NULL DEFAULT 'final' CHECK (status IN ('final', 'entered_in_error')),
  entered_in_error_reason  text,
  entered_in_error_by      uuid        REFERENCES app_user (id),
  FOREIGN KEY (organization_id, patient_id)  REFERENCES patient (organization_id, id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (patient_id, visit_id)         REFERENCES visit (patient_id, id),
  CHECK ((systolic_mmhg IS NULL) = (diastolic_mmhg IS NULL)),
  CHECK (systolic_mmhg IS NULL OR systolic_mmhg > diastolic_mmhg),
  CHECK (num_nonnulls(systolic_mmhg, heart_rate_bpm, respiratory_rate_bpm, temperature_c, spo2_percent,
                      weight_kg, height_cm, blood_glucose_mg_dl) > 0),
  CHECK ((status = 'entered_in_error') = (entered_in_error_reason IS NOT NULL))
);
CREATE INDEX vital_sign_set_patient_idx ON vital_sign_set (patient_id, measured_at DESC);

CREATE TABLE allergy_intolerance (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL,
  patient_id            uuid        NOT NULL,
  category              text        NOT NULL CHECK (category IN ('medication', 'food', 'environment', 'biologic', 'other')),
  substance             text        NOT NULL CHECK (length(btrim(substance)) > 0),
  substance_normalized  text        NOT NULL,
  reaction              text,
  severity              text        CHECK (severity IN ('mild', 'moderate', 'severe')),
  criticality           text        NOT NULL DEFAULT 'unable_to_assess' CHECK (criticality IN ('low', 'high', 'unable_to_assess')),
  verification          text        NOT NULL DEFAULT 'unconfirmed' CHECK (verification IN ('unconfirmed', 'confirmed')),
  status                text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'resolved', 'entered_in_error')),
  status_reason         text,
  recorded_by           uuid        NOT NULL REFERENCES app_user (id),
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid        NOT NULL REFERENCES app_user (id),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id),
  CHECK (status = 'active' OR length(btrim(status_reason)) > 0)
);
CREATE INDEX allergy_intolerance_patient_idx ON allergy_intolerance (patient_id) WHERE status = 'active';

-- Allergy history review (e.g. "no known allergies" was asked and confirmed). Append-only.
CREATE TABLE allergy_review (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL,
  patient_id          uuid        NOT NULL,
  no_known_allergies  boolean     NOT NULL,
  reviewed_by         uuid        NOT NULL REFERENCES app_user (id),
  reviewed_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id)
);
CREATE INDEX allergy_review_patient_idx ON allergy_review (patient_id, reviewed_at DESC);
CREATE TRIGGER allergy_review_append_only BEFORE UPDATE OR DELETE ON allergy_review
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TABLE encounter (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL,
  facility_id              uuid        NOT NULL,
  patient_id               uuid        NOT NULL,
  visit_id                 uuid,
  appointment_id           uuid,
  practitioner_id          uuid        NOT NULL,
  modality                 text        NOT NULL DEFAULT 'in_person' CHECK (modality IN ('in_person', 'telemedicine')),
  status                   text        NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'entered_in_error')),
  chief_complaint          text,
  started_at               timestamptz NOT NULL DEFAULT now(),
  started_by               uuid        NOT NULL REFERENCES app_user (id),
  completed_at             timestamptz,
  signed_by_practitioner_id uuid,
  entered_in_error_reason  text,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (patient_id, id),
  FOREIGN KEY (organization_id, facility_id)               REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)                REFERENCES patient (organization_id, id),
  FOREIGN KEY (patient_id, visit_id)                       REFERENCES visit (patient_id, id),
  FOREIGN KEY (patient_id, appointment_id)                 REFERENCES appointment (patient_id, id),
  FOREIGN KEY (organization_id, practitioner_id)           REFERENCES practitioner (organization_id, id),
  FOREIGN KEY (organization_id, signed_by_practitioner_id) REFERENCES practitioner (organization_id, id),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL AND signed_by_practitioner_id IS NOT NULL)),
  CHECK ((status = 'entered_in_error') = (entered_in_error_reason IS NOT NULL))
);
CREATE UNIQUE INDEX encounter_visit_uq ON encounter (visit_id) WHERE visit_id IS NOT NULL AND status <> 'entered_in_error';
CREATE INDEX encounter_patient_idx ON encounter (patient_id, started_at DESC);

ALTER TABLE vital_sign_set ADD FOREIGN KEY (patient_id, encounter_id) REFERENCES encounter (patient_id, id);

-- Every save of an encounter note is a new revision; the latest is current.
-- After signing, revisions are amendments with a reason. Append-only.
CREATE TABLE encounter_note_revision (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL,
  encounter_id      uuid        NOT NULL REFERENCES encounter (id),
  revision_number   integer     NOT NULL CHECK (revision_number > 0),
  kind              text        NOT NULL CHECK (kind IN ('draft', 'signed', 'amendment')),
  template_key      text        NOT NULL DEFAULT 'soap',
  subjective        text,
  objective         text,
  assessment        text,
  plan              text,
  -- Specialty-specific structured fields (configurable templates).
  sections          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  amendment_reason  text,
  authored_by       uuid        NOT NULL REFERENCES app_user (id),
  authored_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (encounter_id, revision_number),
  CHECK (kind <> 'amendment' OR length(btrim(amendment_reason)) > 0)
);
CREATE TRIGGER encounter_note_revision_append_only BEFORE UPDATE OR DELETE ON encounter_note_revision
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TABLE diagnosis (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid        NOT NULL,
  patient_id           uuid        NOT NULL,
  encounter_id         uuid        NOT NULL,
  code_system_key      text,
  code_system_version  text,
  code                 text,
  display              text        NOT NULL CHECK (length(btrim(display)) > 0),
  rank                 text        NOT NULL DEFAULT 'secondary' CHECK (rank IN ('primary', 'secondary')),
  certainty            text        NOT NULL DEFAULT 'provisional' CHECK (certainty IN ('provisional', 'confirmed', 'refuted')),
  is_chronic           boolean     NOT NULL DEFAULT false,
  notes                text,
  status               text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'entered_in_error')),
  status_reason        text,
  recorded_by          uuid        NOT NULL REFERENCES app_user (id),
  recorded_at          timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid        NOT NULL REFERENCES app_user (id),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (patient_id, id),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id),
  FOREIGN KEY (patient_id, encounter_id)    REFERENCES encounter (patient_id, id),
  CHECK ((code IS NULL) = (code_system_key IS NULL)),
  CHECK (status = 'active' OR length(btrim(status_reason)) > 0)
);
CREATE UNIQUE INDEX diagnosis_primary_uq ON diagnosis (encounter_id) WHERE rank = 'primary' AND status <> 'entered_in_error';
CREATE INDEX diagnosis_patient_idx ON diagnosis (patient_id) WHERE status = 'active';
