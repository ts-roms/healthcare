-- Results shown to patients (docs/domains/assistant.md, phase 3 — "result wording"): a compliance area for the
-- organization to record who reviewed what MyHealth shows of laboratory results — which tests are released to patients
-- (each test's `patient_releasable`) and the platform's fixed wording that explains a result against the laboratory's
-- usual range (versioned as RESULT_WORDING_VERSION in @healthcare/domain/portal-results). The platform decides neither:
-- the review is the organization's, recorded like the other areas (append-only `compliance_review`).

ALTER TABLE compliance_review DROP CONSTRAINT compliance_review_area_check;
ALTER TABLE compliance_review ADD CONSTRAINT compliance_review_area_check
  CHECK (area IN ('billing_tax', 'procurement', 'controlled_drugs', 'laboratory_licensing', 'doh_reporting', 'data_privacy', 'dental_estimates',
                  'patient_results'));
