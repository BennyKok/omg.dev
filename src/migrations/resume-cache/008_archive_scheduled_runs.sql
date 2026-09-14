-- Two columns the archive picker needs, added together because they are the
-- same user outcome: an archive you can actually read.
--
-- 1. `scheduled` marks a row as a headless auto-agent run. Those runs write an
--    ordinary Claude transcript, so they flooded the picker: on this box 388 of
--    the 583 rows from the last seven days were watch-agent runs. The picker now
--    hides them by default.
--
-- 2. `archived_at` records when a session was actually closed. `last_activity_at`
--    is the transcript's final turn, which is NOT the same instant: a session
--    reclaimed under memory pressure, or closed hours after its last message,
--    sorted far down the list the moment it was archived. Rows that predate this
--    column stay NULL and fall back to `last_activity_at` in the ordering, so no
--    backfill is needed or possible.
ALTER TABLE resumable_sessions ADD COLUMN scheduled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE resumable_sessions ADD COLUMN archived_at INTEGER;

-- Backfill `scheduled` directly instead of forcing a re-enrichment pass. The
-- marker is the runner's SYSTEM preamble (src/auto/watch-agent-signature.ts),
-- which is already stored verbatim at the head of the title and the last user
-- text, so SQL can see it without re-reading 4,900 transcripts.
UPDATE resumable_sessions
SET scheduled = 1
WHERE title LIKE 'You are an autonomous watch agent.%'
   OR last_user_text LIKE 'You are an autonomous watch agent.%';

-- The picker's default page is "not scheduled, newest archive first".
CREATE INDEX IF NOT EXISTS resumable_sessions_archive_order
  ON resumable_sessions(scheduled, COALESCE(archived_at, last_activity_at) DESC);

PRAGMA user_version = 8;
