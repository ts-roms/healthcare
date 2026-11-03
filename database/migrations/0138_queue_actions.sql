-- Reception queue actions (kiosk brief, phase 4): a called patient who never came forward is closed as a no-show
-- (still "left without being seen", but told apart), and a closed visit can be put back in line once (a patient who
-- stepped out and returned). No new status: the queue's own states are unchanged.

ALTER TABLE visit ADD COLUMN no_show_at timestamptz;
ALTER TABLE visit ADD COLUMN requeued_count integer NOT NULL DEFAULT 0 CHECK (requeued_count >= 0);

-- A no-show is a visit closed as left-without-being-seen; reopening a visit clears the mark.
ALTER TABLE visit ADD CONSTRAINT visit_no_show_closed_check CHECK (no_show_at IS NULL OR status = 'left_without_being_seen');
