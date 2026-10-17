CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  display_name TEXT NOT NULL,
  real_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('admin','teacher')),
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE TABLE setup_lock (id INTEGER PRIMARY KEY CHECK (id = 1));
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sessions_by_user ON sessions(user_id);
CREATE TABLE invites (
  code_hash TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','teacher')),
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  used_by TEXT REFERENCES users(id),
  used_at TEXT,
  disabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE score_states (
  owner_id TEXT PRIMARY KEY REFERENCES users(id),
  data TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
CREATE TABLE auth_attempts (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
