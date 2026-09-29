-- Management dashboard extras (docs/architecture/management-dashboard.md): specimen rejection rate, results per
-- instrument, online consultations and dental procedure codes read these tables by organization and time, which had
-- no such index yet. No new permission (revenue gating uses the existing billing.report.read) and no new table.

-- Specimens collected in a period (rejection rate = rejected ÷ collected).
CREATE INDEX IF NOT EXISTS lab_specimen_collected_idx ON lab_specimen (organization_id, collected_at);

-- First result versions entered in a period (results per instrument).
CREATE INDEX IF NOT EXISTS lab_result_first_entered_idx ON lab_result (organization_id, entered_at) WHERE version_number = 1;

-- Online consultations started in a period.
CREATE INDEX IF NOT EXISTS telemedicine_session_started_idx ON telemedicine_session (organization_id, started_at) WHERE started_at IS NOT NULL;

-- Dental procedures performed in a period.
CREATE INDEX IF NOT EXISTS dental_procedure_performed_idx ON dental_procedure (organization_id, performed_at) WHERE status = 'recorded';
