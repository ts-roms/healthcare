-- Clinician review of outside results (docs/domains/outside-results.md, "Review").
--
-- A report filed from another laboratory or hospital waits until a clinician has read it. Review records who read
-- it and when, with an optional note; it says nothing about what the report shows and changes nothing in the
-- record. A filing is reviewed once and a filing marked entered in error is never reviewed. Filings made before this
-- migration are unreviewed.

INSERT INTO permission (key, description) VALUES
  ('outside-result.review', 'Record that a filed outside result has been read by a clinician, and list the filings awaiting review');

INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, g.permission_key FROM role r JOIN (VALUES
  ('physician', 'outside-result.review'),
  ('dentist', 'outside-result.review')
) AS g (role_key, permission_key) ON g.role_key = r.key AND r.is_system
ON CONFLICT DO NOTHING;

ALTER TABLE outside_result
  ADD COLUMN reviewed_by uuid REFERENCES app_user (id),
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN review_note text CHECK (length(btrim(review_note)) BETWEEN 1 AND 500),
  ADD CONSTRAINT outside_result_review_complete CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL)),
  ADD CONSTRAINT outside_result_review_note_needs_review CHECK (review_note IS NULL OR reviewed_at IS NOT NULL);

-- The queue of filings still awaiting a clinician.
CREATE INDEX outside_result_unreviewed_idx ON outside_result (organization_id, recorded_at)
  WHERE reviewed_at IS NULL AND entered_in_error_at IS NULL;

-- Immutable except: marking entered in error (once) and review (once, never on an entry in error). Never deleted.
CREATE OR REPLACE FUNCTION outside_result_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable constant text[] := ARRAY['entered_in_error_reason', 'entered_in_error_by', 'entered_in_error_at',
                                   'reviewed_by', 'reviewed_at', 'review_note'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'outside results are never deleted; mark them entered in error' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable)
     OR (OLD.entered_in_error_at IS NOT NULL AND (NEW.entered_in_error_at, NEW.entered_in_error_by, NEW.entered_in_error_reason)
                                                 IS DISTINCT FROM (OLD.entered_in_error_at, OLD.entered_in_error_by, OLD.entered_in_error_reason))
     OR (OLD.reviewed_at IS NOT NULL AND (NEW.reviewed_at, NEW.reviewed_by, NEW.review_note)
                                         IS DISTINCT FROM (OLD.reviewed_at, OLD.reviewed_by, OLD.review_note))
     OR (OLD.entered_in_error_at IS NOT NULL AND NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at) THEN
    RAISE EXCEPTION 'outside result: only marking entered in error or a review, once each, is permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
