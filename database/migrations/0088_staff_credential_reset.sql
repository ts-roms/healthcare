-- An administrator resets a staff member's password (a temporary one, given to the person directly) or turns off their
-- two-step verification. After a password reset the person must choose a new password before doing anything else: the
-- API refuses every other route while this is set (docs/security/access-control.md, "Credential resets by an administrator").

ALTER TABLE app_user ADD COLUMN password_change_required boolean NOT NULL DEFAULT false;
