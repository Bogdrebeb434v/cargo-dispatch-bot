CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_states (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS geocode_cache (
  query TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  label TEXT NOT NULL,
  cached_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT,
  client_username TEXT,
  chat_id TEXT,
  vehicle_id TEXT,
  from_addr TEXT,
  to_addr TEXT,
  stops TEXT,
  empty_km REAL,
  loaded_km REAL,
  duration_min REAL,
  extras TEXT,
  breakdown TEXT,
  cost INTEGER,
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'quote',
  comment TEXT,
  phone TEXT,
  slot_at INTEGER,
  reminded INTEGER NOT NULL DEFAULT 0,
  review_score INTEGER,
  review_text TEXT,
  maps_google TEXT,
  maps_yandex TEXT,
  kind TEXT NOT NULL DEFAULT 'quote'
);

CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_slot ON quotes(slot_at, reminded, status);

CREATE TABLE IF NOT EXISTS rate_limits (
  user_id TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blacklist (
  user_id TEXT PRIMARY KEY,
  reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS address_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  address TEXT NOT NULL,
  used_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_addr_user ON address_history(user_id, used_at DESC);

CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'free',
  quote_id INTEGER,
  UNIQUE(date, time)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assistant_history (
  user_id TEXT PRIMARY KEY,
  messages TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
