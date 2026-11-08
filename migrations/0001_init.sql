-- Core schema for the shared item booking app.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT,
  password_salt TEXT,
  google_sub TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'user',        -- 'admin' | 'user'
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'active' | 'suspended'
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users (google_sub);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,          -- sha256 of the cookie token
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  photo_key TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  max_days INTEGER,                     -- per booking, null = global default
  max_bookings_per_period INTEGER,
  period_days INTEGER,
  min_gap_days INTEGER,
  advance_days INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_access (
  item_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (item_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_item_access_user ON item_access (user_id);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  start_date TEXT NOT NULL,   -- inclusive, YYYY-MM-DD
  end_date TEXT NOT NULL,     -- inclusive, YYYY-MM-DD
  status TEXT NOT NULL DEFAULT 'confirmed',  -- 'confirmed' | 'cancelled'
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_bookings_item_dates ON bookings (item_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings (user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- 'start' | 'end'
  media_key TEXT NOT NULL,
  media_type TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (booking_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_reports_booking ON reports (booking_id);

CREATE TABLE IF NOT EXISTS returns (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  address TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  booking_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- 'start' | 'end' | 'address'
  count INTEGER NOT NULL DEFAULT 0,
  last_sent_at TEXT,
  PRIMARY KEY (booking_id, kind)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  first_at TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('org_name', 'Caravan Club'),
  ('timezone', 'UTC'),
  ('default_max_days', '7'),
  ('default_max_bookings_per_period', '2'),
  ('default_period_days', '30'),
  ('default_min_gap_days', '3'),
  ('default_advance_days', '90'),
  ('require_approval', '1')
ON CONFLICT(key) DO NOTHING;
