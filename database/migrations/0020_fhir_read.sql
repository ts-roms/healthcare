-- FHIR R4 read access (Phase 8, interoperability). See docs/interoperability/fhir.md.
--
-- A read-only FHIR facade over the platform's records (mapping in libs/interoperability). No tables: the internal
-- model stays the source of truth and FHIR resources are produced on request. One permission, held by organization
-- administrators; grant it to an integration account's role deliberately. Every access is audited.

INSERT INTO permission (key, description) VALUES
  ('interop.fhir.read', 'Read patient records through the FHIR R4 interface (whole-record export; audited)');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'interop.fhir.read' FROM role r
WHERE r.key = 'org_admin' AND r.is_system
ON CONFLICT DO NOTHING;
