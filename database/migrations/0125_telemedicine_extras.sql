-- Telemedicine follow-ups (docs/domains/telemedicine.md):
--
-- 1. The organization's own acknowledgement wording: an online consultation's questionnaire records which version of the
--    organization's `telemedicine` consent wording (consent_text) the patient saw when acknowledging. No row = the
--    platform's plain default statement was shown (nothing has been validated against DOH or NPC guidance either way).
-- 2. A telemedicine setting per organization: whether an online visit must be paid for before the waiting room opens
--    (billing's prepaid policy; off by default).
-- 3. A text chat between patient and clinician during an online consultation (the fallback when video fails),
--    append-only like the rest of the clinical record.

-- ---- 1. Acknowledgement wording -------------------------------------------------------------------------------------

ALTER TABLE telemedicine_session
  ADD COLUMN acknowledgement_text_id uuid,
  ADD CONSTRAINT telemedicine_session_ack_text_fk FOREIGN KEY (organization_id, acknowledgement_text_id) REFERENCES consent_text (organization_id, id);

-- ---- 2. Setting -----------------------------------------------------------------------------------------------------

CREATE TABLE telemedicine_setting (
  organization_id  uuid        PRIMARY KEY REFERENCES organization (id),
  -- The online visit's invoice must be paid (or covered) before the patient may enter the waiting room.
  payment_required boolean     NOT NULL DEFAULT false,
  updated_by       uuid        NOT NULL REFERENCES app_user (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0)
);

-- ---- 3. Chat --------------------------------------------------------------------------------------------------------

CREATE TABLE telemedicine_message (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL,
  session_id       uuid        NOT NULL,
  patient_id       uuid        NOT NULL,
  sender_type      text        NOT NULL CHECK (sender_type IN ('patient', 'staff')),
  -- The clinician (null for the patient, who has no staff user).
  sender_user_id   uuid        REFERENCES app_user (id),
  -- The name shown to the other side, as it was when sent.
  sender_name      text        NOT NULL CHECK (length(btrim(sender_name)) BETWEEN 1 AND 200),
  body             text        NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, session_id) REFERENCES telemedicine_session (organization_id, id),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patient (organization_id, id),
  CHECK ((sender_type = 'staff') = (sender_user_id IS NOT NULL))
);
CREATE INDEX telemedicine_message_session_idx ON telemedicine_message (session_id, created_at, id);

-- A message is never edited or removed: what was said during the consultation stays as it was.
CREATE TRIGGER telemedicine_message_append_only BEFORE UPDATE OR DELETE ON telemedicine_message
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
