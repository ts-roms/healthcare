-- Periodontal charting (Phase 6 follow-up). See docs/domains/dental.md#periodontal-charting.
--
-- A periodontal chart is recorded by a dentist during the patient's visit: per tooth, six sites (mesio-, mid- and
-- disto-buccal; mesio-, mid- and disto-lingual/palatal) with probing depth, gingival margin (recession), bleeding on
-- probing, suppuration and plaque, and per tooth mobility and furcation involvement. Measurements only: the platform
-- derives attachment levels and summaries but never stages or grades periodontal disease.
-- Like examinations, a chart is immutable once recorded; a mistaken one is marked entered in error (with a reason).

CREATE TABLE dental_perio_chart (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL,
  facility_id              uuid        NOT NULL,
  patient_id               uuid        NOT NULL,
  encounter_id             uuid        NOT NULL,
  practitioner_id          uuid        NOT NULL,
  notes                    text        CHECK (length(notes) <= 4000),
  status                   text        NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'entered_in_error')),
  entered_in_error_reason  text,
  entered_in_error_at      timestamptz,
  entered_in_error_by      uuid        REFERENCES app_user (id),
  recorded_by              uuid        NOT NULL REFERENCES app_user (id),
  recorded_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (patient_id, id),
  FOREIGN KEY (organization_id, facility_id)     REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, patient_id)      REFERENCES patient (organization_id, id),
  FOREIGN KEY (patient_id, encounter_id)         REFERENCES encounter (patient_id, id),
  FOREIGN KEY (organization_id, practitioner_id) REFERENCES practitioner (organization_id, id),
  CHECK ((status = 'entered_in_error') = (length(btrim(entered_in_error_reason)) >= 5 AND entered_in_error_at IS NOT NULL AND entered_in_error_by IS NOT NULL))
);
CREATE INDEX dental_perio_chart_patient_idx ON dental_perio_chart (organization_id, patient_id, recorded_at DESC);
CREATE TRIGGER dental_perio_chart_immutable BEFORE UPDATE OR DELETE ON dental_perio_chart
  FOR EACH ROW EXECUTE FUNCTION dental_record_guard();

-- One examined tooth of a chart (teeth not listed were not examined). Mobility 0–3 (Miller); furcation 0–3 (Glickman
-- classes I–III as 1–3), only on multi-rooted teeth (validated by the service).
CREATE TABLE dental_perio_tooth (
  id               uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid     NOT NULL,
  patient_id       uuid     NOT NULL,
  chart_id         uuid     NOT NULL,
  tooth            text     NOT NULL CHECK (tooth ~ '^([1-4][1-8]|[5-8][1-5])$'),
  mobility         smallint CHECK (mobility BETWEEN 0 AND 3),
  furcation        smallint CHECK (furcation BETWEEN 0 AND 3),
  UNIQUE (organization_id, id),
  UNIQUE (chart_id, tooth),
  FOREIGN KEY (patient_id, chart_id) REFERENCES dental_perio_chart (patient_id, id)
);
CREATE TRIGGER dental_perio_tooth_append_only BEFORE UPDATE OR DELETE ON dental_perio_tooth
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- A measured site. Gingival margin in mm relative to the cemento-enamel junction: positive = recession (apical to the
-- CEJ), negative = margin coronal to it. Clinical attachment level = probing depth + gingival margin (derived).
CREATE TABLE dental_perio_site (
  id               uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid     NOT NULL,
  tooth_id         uuid     NOT NULL,
  site             text     NOT NULL CHECK (site IN ('MB', 'B', 'DB', 'ML', 'L', 'DL')),
  probing_depth    smallint CHECK (probing_depth BETWEEN 0 AND 20),
  gingival_margin  smallint CHECK (gingival_margin BETWEEN -10 AND 20),
  bleeding         boolean  NOT NULL DEFAULT false,
  suppuration      boolean  NOT NULL DEFAULT false,
  plaque           boolean  NOT NULL DEFAULT false,
  UNIQUE (tooth_id, site),
  FOREIGN KEY (organization_id, tooth_id) REFERENCES dental_perio_tooth (organization_id, id)
);
CREATE TRIGGER dental_perio_site_append_only BEFORE UPDATE OR DELETE ON dental_perio_site
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
