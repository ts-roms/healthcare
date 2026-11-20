-- Prescribing: the organization's own medicine settings for decision support (docs/domains/prescription.md,
-- "Medicine settings"; docs/domains/assistant.md, the prescribing rules).
--
-- One row per medicine as the organization writes it, matched by its words against the generic names prescribers type:
-- an optional class of the organization's own (two medicines of one class are a duplicate therapy), an optional maximum
-- daily dose in one unit, and whether the assistant prompts a kidney-function or a pregnancy check before prescribing,
-- with the organization's own note. Only the assistant's prescribing rules read it, and they are off until an
-- administrator turns them on; nothing here blocks or changes a prescription. No dose, class, interaction or check is
-- shipped: every value is the organization's own, validated by its clinicians (compliance register).
--
-- Managed with clinic.configure, read with prescription.read: no new permission.

CREATE TABLE prescribing_medicine (
  id               uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid           NOT NULL REFERENCES organization (id),
  name             text           NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  -- The name's words as the matching reads them (lower case, without strengths and dosage forms): one setting per medicine.
  name_key         text           NOT NULL CHECK (length(name_key) BETWEEN 1 AND 120),
  class_name       text           CHECK (length(btrim(class_name)) BETWEEN 2 AND 80),
  max_daily_dose   numeric(12, 3) CHECK (max_daily_dose > 0),
  dose_unit        text           CHECK (length(btrim(dose_unit)) BETWEEN 1 AND 20),
  check_renal      boolean        NOT NULL DEFAULT false,
  check_pregnancy  boolean        NOT NULL DEFAULT false,
  -- The organization's own wording shown with the suggestions (for example what to look at before prescribing).
  note             text           CHECK (length(btrim(note)) BETWEEN 1 AND 300),
  status           text           NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  version          integer        NOT NULL DEFAULT 1,
  created_by       uuid           NOT NULL REFERENCES app_user (id),
  updated_by       uuid           NOT NULL REFERENCES app_user (id),
  created_at       timestamptz    NOT NULL DEFAULT now(),
  updated_at       timestamptz    NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name_key),
  -- A maximum is given in one unit (no conversion between units is made).
  CHECK ((max_daily_dose IS NULL) = (dose_unit IS NULL)),
  -- A setting says something: a class, a maximum or a check.
  CHECK (class_name IS NOT NULL OR max_daily_dose IS NOT NULL OR check_renal OR check_pregnancy)
);
