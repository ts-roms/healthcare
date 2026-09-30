-- Referral follow-up (docs/domains/clinic.md, "Referrals"): referrals join the merged-record refusal of 0068, and each
-- organization may flag referrals still waiting for an answer or reply after a number of days it chooses (off by
-- default: no national or professional deadline is assumed).

-- New referrals are not filed under a record merged into another (PM001 → 422 patient_merged).
CREATE TRIGGER referral_not_for_merged_patient BEFORE INSERT ON referral
  FOR EACH ROW EXECUTE FUNCTION refuse_record_for_merged_patient();

CREATE TABLE referral_setting (
  organization_id     uuid        PRIMARY KEY REFERENCES organization (id),
  -- Null: referrals are never flagged as overdue.
  overdue_after_days  integer     CHECK (overdue_after_days BETWEEN 1 AND 365),
  version             integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by          uuid        NOT NULL REFERENCES app_user (id),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Referrals still waiting for the recipient, oldest first (the overdue list); the existing referral_open index covers
-- open ones in general, this one the "sent" subset the overdue flag reads.
CREATE INDEX referral_awaiting ON referral (organization_id, issued_at) WHERE status = 'sent';
