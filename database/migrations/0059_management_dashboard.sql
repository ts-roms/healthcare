-- Management dashboard: operational figures across clinic, laboratory, dental, billing and the Patient Master over a
-- date range, per facility or for the whole organization (docs/architecture/management-dashboard.md). Read only;
-- counts and amounts, no patient. Revenue figures are operational, not BIR reporting.

INSERT INTO permission (key, description)
VALUES ('management.dashboard.read', 'View the management dashboard: patient volume, revenue, services, provider and laboratory figures');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'management.dashboard.read' FROM role r
WHERE r.key = 'org_admin' AND r.is_system
ON CONFLICT DO NOTHING;

-- The dashboard filters these by organization, facility and time.
CREATE INDEX IF NOT EXISTS encounter_completed_idx ON encounter (organization_id, completed_at) WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS billing_invoice_issued_idx ON billing_invoice (organization_id, issued_at) WHERE status = 'issued';
CREATE INDEX IF NOT EXISTS billing_payment_recorded_idx ON billing_payment (organization_id, recorded_at);
CREATE INDEX IF NOT EXISTS lab_result_released_idx ON lab_result (organization_id, released_at) WHERE released_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS lab_order_ordered_idx ON lab_order (organization_id, ordered_at);
CREATE INDEX IF NOT EXISTS patient_created_idx ON patient (organization_id, created_at);
