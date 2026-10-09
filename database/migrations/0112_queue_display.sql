-- Waiting-room display (docs/domains/clinic.md, "Waiting-room display").
--
-- A screen in the waiting area shows the tickets staff called and where to go ("A-007 → Room 2") and how many are
-- waiting — never a name, patient number, visit type, priority or complaint. It reads GET /queue/display and joins the
-- facility's live queue updates. A dedicated staff account per facility holding only the queue_display role signs in
-- on the screen; reception and administrators may open it too.

INSERT INTO permission (key, description) VALUES
  ('clinic.queue.display', 'Show the waiting-room display: called tickets and where to go, and how many are waiting (no patient details)');

INSERT INTO role (key, name, description, is_system) VALUES
  ('queue_display', 'Waiting-room display', 'For a screen in the waiting area: called tickets only, nothing else', true);

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('queue_display', 'clinic.queue.display'),
  ('receptionist', 'clinic.queue.display'),
  ('org_admin', 'clinic.queue.display')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system
ON CONFLICT DO NOTHING;
