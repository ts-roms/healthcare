-- Heuristic assistant, phase 2: the doctor's workspace and the laboratory (docs/domains/assistant.md).
--
-- Phase 2 adds rules in the consultation workspace (what the record does not hold yet before signing; codes the
-- organization has used for the words written) and on the laboratory workbench (a result far from the patient's last
-- released one). The people who work there may see suggestions; each rule still needs that screen's own permission
-- (encounter.read, lab.result.read), and every rule stays off until an administrator turns it on.
-- No table changes.

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'assistant.use' FROM role r
WHERE r.key IN ('physician', 'dentist', 'medical_technologist', 'pathologist') AND r.is_system
ON CONFLICT DO NOTHING;
