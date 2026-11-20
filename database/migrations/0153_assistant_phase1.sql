-- Heuristic assistant, phase 1 (docs/architecture/heuristic-assistant.md, docs/domains/assistant.md).
--
-- Phase 1 adds rules on the billing desk (procedures with no charge), the appointments board (patients who often miss
-- appointments) and the queue (waits longer than usual). The people who work those screens may see suggestions; each
-- rule still needs that screen's own permission, and every rule stays off until an administrator turns it on.
-- No table changes: suggestions are computed on demand, settings and feedback are the tables of 0152.

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'assistant.use' FROM role r
WHERE r.key IN ('cashier', 'receptionist', 'nurse') AND r.is_system
ON CONFLICT DO NOTHING;
