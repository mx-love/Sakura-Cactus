ALTER TABLE posts ADD COLUMN pinned_at TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_pinned_at ON posts(pinned_at);
