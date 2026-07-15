-- Cross-instance rate limits and a lightweight schema bootstrap marker.

CREATE TABLE IF NOT EXISTS rate_limits (
  scope TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, key_hash, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at ON rate_limits(expires_at);

CREATE TABLE IF NOT EXISTS sakura_schema_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO sakura_schema_state (id, version, updated_at)
VALUES (1, 8, datetime('now'))
ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at;
