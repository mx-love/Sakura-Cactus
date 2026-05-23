-- Site settings, view counts, and pending friend applications.

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO site_settings (key, value, updated_at) VALUES
  ('friend_apply_enabled', 'false', datetime('now')),
  ('comment_enabled', 'false', datetime('now')),
  ('comment_provider', 'off', datetime('now')),
  ('comment_config', '{}', datetime('now')),
  ('view_count_enabled', 'false', datetime('now')),
  ('favicon_url', '', datetime('now')),
  ('maintenance_last_run_at', '', datetime('now'));

CREATE TABLE IF NOT EXISTS post_view_counts (
  post_id TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

PRAGMA foreign_keys=off;

CREATE TABLE friend_links_v2 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  avatar_url TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'hidden', 'pending')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO friend_links_v2 (
  id, name, url, avatar_url, description, status, sort_order, created_at, updated_at
)
SELECT id, name, url, avatar_url, description, status, sort_order, created_at, updated_at
FROM friend_links;

DROP TABLE friend_links;
ALTER TABLE friend_links_v2 RENAME TO friend_links;

PRAGMA foreign_keys=on;

CREATE INDEX IF NOT EXISTS idx_friend_links_status ON friend_links(status);
CREATE INDEX IF NOT EXISTS idx_friend_links_sort_order ON friend_links(sort_order);
CREATE INDEX IF NOT EXISTS idx_friend_links_created_at ON friend_links(created_at);
