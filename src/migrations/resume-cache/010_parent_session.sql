-- The session that started this one, stamped by the close path. A parent's
-- Team view lists its finished children from here: closing a session removes
-- its registry row, so nothing else remembers the link. Rows closed before
-- this column existed stay NULL; there is no source to backfill from.
ALTER TABLE resumable_sessions ADD COLUMN parent_session_id TEXT;
CREATE INDEX IF NOT EXISTS resumable_sessions_parent
  ON resumable_sessions(parent_session_id)
  WHERE parent_session_id IS NOT NULL;
PRAGMA user_version = 10;
