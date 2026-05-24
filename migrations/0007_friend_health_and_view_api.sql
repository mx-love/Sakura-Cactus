-- Friend health checks and safer client-side view counting.

INSERT OR IGNORE INTO site_settings (key, value, updated_at)
VALUES ('friend_health_enabled', 'false', datetime('now'));

ALTER TABLE friend_links ADD COLUMN health_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE friend_links ADD COLUMN last_checked_at TEXT;
ALTER TABLE friend_links ADD COLUMN last_status_code INTEGER;
ALTER TABLE friend_links ADD COLUMN last_error TEXT;
ALTER TABLE friend_links ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_friend_links_health_status ON friend_links(health_status);
CREATE INDEX IF NOT EXISTS idx_friend_links_last_checked_at ON friend_links(last_checked_at);
