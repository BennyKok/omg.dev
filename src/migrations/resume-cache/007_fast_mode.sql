BEGIN;

ALTER TABLE resumable_sessions ADD COLUMN thinking_level TEXT;
ALTER TABLE resumable_sessions ADD COLUMN service_tier TEXT;
ALTER TABLE resumable_sessions ADD COLUMN fast_mode INTEGER NOT NULL DEFAULT 0;

PRAGMA user_version = 7;

COMMIT;
