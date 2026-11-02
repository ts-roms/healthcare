-- Government and insurance identifiers (PhilHealth PIN, PhilSys, passport, licence, senior/PWD ID, HMO number) are returned
-- masked (last four digits) by the patient record API unless the caller holds patient.identifier.reveal (VR-18 of the
-- security audit; docs/security-audit). Searching by identifier is unchanged. Roles that work with the numbers at the
-- desk, in billing or in records keep seeing them; clinical roles see the masked form.

INSERT INTO permission (key, description)
VALUES ('patient.identifier.reveal', 'See government and insurance identifiers in full instead of masked');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'patient.identifier.reveal' FROM role r
WHERE r.key IN ('org_admin', 'records_officer', 'receptionist', 'cashier') AND r.is_system
ON CONFLICT DO NOTHING;
