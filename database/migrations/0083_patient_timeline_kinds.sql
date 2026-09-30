-- Patient timeline: further kinds (docs/domains/patient-timeline.md) — allergies, triage, critical-value
-- communication, credit and debit notes, PhilHealth claims, DOH case reports and dispensing.
-- No new tables or permissions: each kind is gated by its domain's existing read permission. These indexes serve the
-- per-patient, newest-first page queries whose sources had no index leading with the patient yet. Sources not listed
-- here already had one: consents, allergy reviews, dental images and periodontal charts, deposits, eligibility and
-- YAKAP answers, medical certificates and records requests (patient and time), queue visits and specimens (the
-- UNIQUE (patient_id, id) keys; specimen events are then found by lab_specimen_event_specimen_idx).

-- Every allergy of a patient, by when recorded (the existing index covers active allergies only).
CREATE INDEX allergy_intolerance_patient_recorded_idx ON allergy_intolerance (organization_id, patient_id, recorded_at DESC);

-- Triage assessments of a patient.
CREATE INDEX triage_assessment_patient_idx ON triage_assessment (organization_id, patient_id, assessed_at DESC);

-- Critical-value alerts of a patient (communicated or acknowledged).
CREATE INDEX lab_critical_alert_patient_idx ON lab_critical_alert (patient_id, raised_at DESC);

-- Credit and debit notes of a patient.
CREATE INDEX billing_credit_note_patient_idx ON billing_credit_note (organization_id, patient_id, issued_at DESC);
CREATE INDEX billing_debit_note_patient_idx ON billing_debit_note (organization_id, patient_id, issued_at DESC);

-- Outbound exchanges about a patient (PhilHealth claims).
CREATE INDEX integration_exchange_patient_idx ON integration_exchange (organization_id, patient_id, requested_at DESC) WHERE patient_id IS NOT NULL;

-- DOH case reports of a patient.
CREATE INDEX doh_case_report_patient_idx ON doh_case_report (organization_id, patient_id, detected_at DESC);

-- Dispenses to a patient.
CREATE INDEX prescription_dispense_patient_idx ON prescription_dispense (organization_id, patient_id, dispensed_at DESC);
