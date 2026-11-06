CREATE TABLE IF NOT EXISTS request_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  started_at TEXT NOT NULL
);
