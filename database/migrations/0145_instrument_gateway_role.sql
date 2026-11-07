-- Zero trust for the instrument gateway's machine identity (docs/security/zero-trust-audit-2026-11-06.md, S2;
-- docs/domains/laboratory-instruments.md, "Instrument gateway").
--
-- The gateway signs in with a password kept on an on-site computer and without two-step verification. Until now only
-- org_admin held lab.instrument.message.submit, so the easy set-up was an exempted administrator: whoever read that
-- password held the whole organization. The gateway now gets its own built-in role holding that one permission (as the
-- kiosk print agent has, 0139), org_admin no longer holds it, and the gateway refuses to send as an account holding
-- anything else (apps/instrument-gateway/src/api-client.ts).

INSERT INTO role (key, name, description, is_system) VALUES
  ('instrument_gateway', 'Instrument gateway', 'For the on-site analyzer gateway: submits analyzer result messages for review only, no patient records', true)
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'lab.instrument.message.submit' FROM role r WHERE r.key = 'instrument_gateway' AND r.is_system
ON CONFLICT DO NOTHING;

DELETE FROM role_permission rp
USING role r
WHERE rp.role_id = r.id AND r.key = 'org_admin' AND r.is_system AND rp.permission_key = 'lab.instrument.message.submit';
