-- Heuristic assistant, phase 3: the pharmacy (docs/domains/assistant.md).
--
-- Phase 3 adds rules on the pharmacy screens (waiting prescriptions that the facility's stock cannot fill; stock that
-- would expire before the course it is handed over for ends). Pharmacists may see suggestions; each rule still needs
-- the screen's own permissions (prescription.dispense, inventory.read), and every rule stays off until an administrator
-- turns it on. Nurses, who also dispense, hold assistant.use since 0153.
-- No table changes.

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'assistant.use' FROM role r
WHERE r.key = 'pharmacist' AND r.is_system
ON CONFLICT DO NOTHING;
