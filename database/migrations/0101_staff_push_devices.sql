-- Push notifications for staff (docs/domains/notification.md, "Push"; D4 phase 2).
--
-- A staff member may allow notifications in their browser, like a patient in MyHealth: the same table, limits, failure
-- handling and sender. A row belongs to exactly one owner — a MyHealth account (portal_account_id) or a staff account
-- (user_id). A push to staff mirrors an in-app notice they get anyway and carries the same content-free text (a title, one
-- line and the staff page it is about); templates that must not leave the platform (free text) never go this way.
-- A suspended or disabled account receives nothing (the recipient directory refuses it); its devices stay registered so
-- reinstatement needs no set-up.

ALTER TABLE push_subscription
  ALTER COLUMN portal_account_id DROP NOT NULL,
  ADD COLUMN user_id uuid REFERENCES app_user (id),
  ADD CONSTRAINT push_subscription_one_owner CHECK ((portal_account_id IS NULL) <> (user_id IS NULL)),
  DROP CONSTRAINT push_subscription_revoked_reason_check,
  ADD CONSTRAINT push_subscription_revoked_reason_check
    CHECK (revoked_reason IN ('removed_by_patient', 'removed_by_user', 'gone', 'failing', 'moved_to_another_account'));

CREATE INDEX push_subscription_user_idx ON push_subscription (user_id) WHERE revoked_at IS NULL;
