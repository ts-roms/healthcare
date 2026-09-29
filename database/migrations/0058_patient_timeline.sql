-- Patient 360 timeline (apps/api/src/app/patient-timeline, docs/domains/patient-timeline.md).
-- No new tables or permissions: the timeline is a read model composed from each domain's read query, and each kind
-- is gated by the domain's existing read permission. These indexes serve the per-patient, newest-first page queries
-- whose sources had no index on (patient, time) yet.

-- Payments and refunds of a patient, newest first.
CREATE INDEX billing_payment_patient_idx ON billing_payment (organization_id, patient_id, recorded_at DESC);

-- Issued invoices of a patient, newest first.
CREATE INDEX billing_invoice_patient_issued_idx ON billing_invoice (organization_id, patient_id, issued_at DESC) WHERE issued_at IS NOT NULL;

-- Every care plan of a patient (the existing index covers open plans only).
CREATE INDEX care_plan_patient_created_idx ON care_plan (organization_id, patient_id, created_at DESC);

-- Completed care plan activities of a patient.
CREATE INDEX care_plan_activity_patient_completed_idx ON care_plan_activity (organization_id, patient_id, completed_at DESC) WHERE completed_at IS NOT NULL;

-- Released laboratory result versions of a patient, including those corrected later (the existing index covers
-- current released results by test).
CREATE INDEX lab_result_patient_released_idx ON lab_result (patient_id, released_at DESC) WHERE released_at IS NOT NULL;
