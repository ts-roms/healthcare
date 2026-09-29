-- Patient portal: why the latest activation attempt failed (CLAUDE.md §17).
--
-- The patient only ever sees one generic message, so the activation page cannot be used to
-- probe patient numbers or confirm birth dates. Staff who issue codes see the specific reason
-- on the patient record instead. Attempts that match no invited account (unknown patient
-- number or organization) have no row to record against; they are in the audit trail only.

ALTER TABLE patient_portal_account
  ADD COLUMN last_activation_failure    text CHECK (last_activation_failure IN ('expired', 'birth_date_mismatch', 'code_mismatch')),
  ADD COLUMN last_activation_failure_at timestamptz,
  ADD CONSTRAINT patient_portal_account_activation_failure_check
    CHECK ((last_activation_failure IS NULL) = (last_activation_failure_at IS NULL));
