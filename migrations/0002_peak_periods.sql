-- Peak periods: date ranges with their own maximum booking length.
-- A booking that overlaps a peak period is capped at that period's max_days.

CREATE TABLE IF NOT EXISTS peak_periods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,   -- inclusive, YYYY-MM-DD
  end_date TEXT NOT NULL,     -- inclusive, YYYY-MM-DD
  max_days INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_peak_periods_dates ON peak_periods (start_date, end_date);

-- Days a member may book per calendar year before an admin has to approve.
INSERT INTO settings (key, value) VALUES ('yearly_max_days', '36')
ON CONFLICT(key) DO NOTHING;
