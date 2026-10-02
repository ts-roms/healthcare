-- Notifications (docs/domains/notification.md): resend and cancel from the communication log (D4 phase 1).
--
-- A failed, cancelled or suppressed message to a patient can be sent again as a NEW notification through the ordinary
-- send path (consent, preferences and the current contact detail are checked again); the original row never changes
-- and the new one names it in `resent_from`. A queued message can be cancelled with a reason. Both need the new
-- permission `notification.manage` (org_admin, receptionist) and are audited.

ALTER TABLE notification
  ADD COLUMN resent_from uuid REFERENCES notification (id);
CREATE INDEX notification_resent_from_idx ON notification (resent_from) WHERE resent_from IS NOT NULL;

INSERT INTO permission (key, description) VALUES
  ('notification.manage', 'Resend a message to a patient that was not sent, or cancel one not yet sent (communication log)');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('org_admin', 'notification.manage'),
  ('receptionist', 'notification.manage')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system
ON CONFLICT DO NOTHING;
