-- Communication log (docs/domains/notification.md, "Communication log"): staff see what the platform sent, or did not
-- send, to patients across the organization — when, which kind of message, which channel and what became of it
-- (sent, delivered, failed, not sent because of consent or preferences) — never the message, its variables or the
-- full destination. Staff in-app messages are not part of it (the staff inbox is private to its recipient).
--
-- The reception desk handles reminders, no-shows and patients who say they got nothing, so receptionists and records
-- officers may now read the history as physicians, dentists and administrators already could.

CREATE INDEX notification_patient_log_idx ON notification (organization_id, created_at DESC, id DESC) WHERE recipient_type = 'patient';

UPDATE permission SET description = 'View the communication log and patients'' communication history (kind of message, channel, delivery status; never the content)'
WHERE key = 'notification.read';

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('receptionist', 'notification.read'),
  ('records_officer', 'notification.read')
) AS g(role_key, permission_key) ON g.role_key = r.key
WHERE r.is_system
ON CONFLICT DO NOTHING;
