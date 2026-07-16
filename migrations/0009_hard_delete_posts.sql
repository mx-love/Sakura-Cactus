-- Convert posts from soft delete to physical delete.
-- Historical soft-deleted posts are permanently removed before rebuilding the table.

PRAGMA foreign_keys=off;

CREATE TABLE IF NOT EXISTS historical_post_asset_cleanup_candidates (
  asset_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO historical_post_asset_cleanup_candidates (asset_id, created_at)
SELECT DISTINCT post_assets.asset_id, datetime('now')
FROM post_assets
INNER JOIN posts ON posts.id = post_assets.post_id
INNER JOIN assets ON assets.id = post_assets.asset_id
WHERE posts.deleted_at IS NOT NULL
   OR posts.status = 'deleted';

INSERT OR IGNORE INTO historical_post_asset_cleanup_candidates (asset_id, created_at)
SELECT DISTINCT posts.cover_asset_id, datetime('now')
FROM posts
INNER JOIN assets ON assets.id = posts.cover_asset_id
WHERE posts.cover_asset_id IS NOT NULL
  AND (
    posts.deleted_at IS NOT NULL
    OR posts.status = 'deleted'
  );

DELETE FROM post_tags
WHERE post_id IN (
  SELECT id FROM posts
  WHERE deleted_at IS NOT NULL
     OR status = 'deleted'
);

DELETE FROM post_assets
WHERE post_id IN (
  SELECT id FROM posts
  WHERE deleted_at IS NOT NULL
     OR status = 'deleted'
);

DELETE FROM post_view_counts
WHERE post_id IN (
  SELECT id FROM posts
  WHERE deleted_at IS NOT NULL
     OR status = 'deleted'
);

DELETE FROM posts
WHERE deleted_at IS NOT NULL
   OR status = 'deleted';

DROP INDEX IF EXISTS idx_posts_public_lookup;
DROP INDEX IF EXISTS idx_posts_deleted_at;

CREATE TABLE posts_v9 (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT,
  content_markdown TEXT NOT NULL,
  content_html TEXT,
  cover_asset_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  seo_title TEXT,
  seo_description TEXT,
  reading_time_minutes INTEGER NOT NULL DEFAULT 1 CHECK (reading_time_minutes >= 1),
  word_count INTEGER NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  published_at TEXT,
  pinned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (cover_asset_id) REFERENCES assets(id) ON DELETE SET NULL
);

INSERT INTO posts_v9 (
  id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
  seo_title, seo_description, reading_time_minutes, word_count, published_at, pinned_at, created_at, updated_at
)
SELECT id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
  seo_title, seo_description, reading_time_minutes, word_count, published_at, pinned_at, created_at, updated_at
FROM posts;

DROP TABLE posts;
ALTER TABLE posts_v9 RENAME TO posts;

PRAGMA foreign_keys=on;

CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_public_lookup ON posts(status, visibility, published_at);
CREATE INDEX IF NOT EXISTS idx_posts_status_published ON posts(status, published_at);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
CREATE INDEX IF NOT EXISTS idx_posts_pinned_at ON posts(pinned_at);

INSERT INTO sakura_schema_state (id, version, updated_at)
VALUES (1, 9, datetime('now'))
ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at;
