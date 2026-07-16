-- Simplify article lifecycle to browser-only unpublished content and published D1 posts.
-- Historical server-side draft, archived, and non-public posts are permanently removed.
-- Their media asset ids are queued for the existing historical R2 compensation helper.

PRAGMA foreign_keys=off;

BEGIN TRANSACTION;

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
WHERE posts.status != 'published'
   OR posts.visibility != 'public';

INSERT OR IGNORE INTO historical_post_asset_cleanup_candidates (asset_id, created_at)
SELECT DISTINCT posts.cover_asset_id, datetime('now')
FROM posts
INNER JOIN assets ON assets.id = posts.cover_asset_id
WHERE posts.cover_asset_id IS NOT NULL
  AND (
    posts.status != 'published'
    OR posts.visibility != 'public'
  );

DELETE FROM post_tags
WHERE post_id IN (
  SELECT id FROM posts
  WHERE status != 'published'
     OR visibility != 'public'
);

DELETE FROM post_assets
WHERE post_id IN (
  SELECT id FROM posts
  WHERE status != 'published'
     OR visibility != 'public'
);

DELETE FROM post_view_counts
WHERE post_id IN (
  SELECT id FROM posts
  WHERE status != 'published'
     OR visibility != 'public'
);

DELETE FROM posts
WHERE status != 'published'
   OR visibility != 'public';

DROP INDEX IF EXISTS idx_posts_public_lookup;
DROP INDEX IF EXISTS idx_posts_status_published;
DROP INDEX IF EXISTS idx_posts_deleted_at;

CREATE TABLE posts_v10 (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT,
  content_markdown TEXT NOT NULL,
  content_html TEXT,
  cover_asset_id TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public')),
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

INSERT INTO posts_v10 (
  id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
  seo_title, seo_description, reading_time_minutes, word_count, published_at, pinned_at, created_at, updated_at
)
SELECT id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
  seo_title, seo_description, reading_time_minutes, word_count, published_at, pinned_at, created_at, updated_at
FROM posts;

DROP TABLE posts;
ALTER TABLE posts_v10 RENAME TO posts;

CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_public_lookup ON posts(status, visibility, published_at);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
CREATE INDEX IF NOT EXISTS idx_posts_pinned_at ON posts(pinned_at);

INSERT INTO sakura_schema_state (id, version, updated_at)
VALUES (1, 10, datetime('now'))
ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at;

COMMIT;

PRAGMA foreign_keys=on;
