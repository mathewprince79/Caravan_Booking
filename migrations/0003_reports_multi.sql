-- A condition report can now hold up to 5 files instead of exactly one.
-- SQLite cannot drop the old UNIQUE (booking_id, kind) constraint in place, so
-- the table is rebuilt with the existing rows copied across.

CREATE TABLE reports_multi (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- 'start' | 'end'
  media_key TEXT NOT NULL,
  media_type TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO reports_multi (id, booking_id, item_id, user_id, kind, media_key, media_type, notes, created_at)
SELECT id, booking_id, item_id, user_id, kind, media_key, media_type, notes, created_at FROM reports;

DROP TABLE reports;
ALTER TABLE reports_multi RENAME TO reports;

CREATE INDEX IF NOT EXISTS idx_reports_booking ON reports (booking_id);
CREATE INDEX IF NOT EXISTS idx_reports_booking_kind ON reports (booking_id, kind);
