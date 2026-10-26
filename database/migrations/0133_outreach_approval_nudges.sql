-- Outreach: approval nudges (docs/domains/crm.md, "Approval nudges and the test send").
--
-- The people who may approve a campaign are told in the app when one is submitted, and reminded once if it is still
-- waiting after two days; the author is told when it is approved. The reminder is recorded on the campaign so it is
-- sent once. A test send goes only to the person who asked for it (their own notifications and email) and creates no
-- delivery to any patient, so it needs nothing stored.

ALTER TABLE crm_campaign ADD COLUMN approval_reminded_at timestamptz;
