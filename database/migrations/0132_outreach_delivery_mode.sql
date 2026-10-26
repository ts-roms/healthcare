-- Outreach: one message per patient (docs/domains/crm.md, "Wording variables and one message per patient").
--
-- A campaign may be sent on every channel it names (the default, as before) or as one message per patient on the first
-- channel that can reach them, in the order push, text message, email, MyHealth inbox. The delivery record then holds one
-- row for the patient: the channel used, or, for a patient no channel reaches, the first channel in that order with the
-- reason it was not sent. The choice is part of what the second person approves, so it is made while drafting.

ALTER TABLE crm_campaign
  ADD COLUMN delivery_mode text NOT NULL DEFAULT 'all' CHECK (delivery_mode IN ('all', 'first_available'));
