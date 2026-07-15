import { nowIso } from './db';

const CURRENT_SCHEMA_VERSION = 8;
let schemaPromise: Promise<void> | null = null;

async function run(db: D1Database, sql: string): Promise<void> {
  await db.prepare(sql).run();
}

async function runIgnoringDuplicateColumn(db: D1Database, sql: string): Promise<void> {
  try {
    await run(db, sql);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

    if (!message.includes('duplicate column')) {
      throw error;
    }
  }
}

async function ensureTables(db: D1Database): Promise<void> {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      display_name TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      r2_key TEXT NOT NULL UNIQUE,
      original_filename TEXT,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      width INTEGER CHECK (width IS NULL OR width >= 0),
      height INTEGER CHECK (height IS NULL OR height >= 0),
      sha256 TEXT,
      visibility TEXT NOT NULL DEFAULT 'draft' CHECK (visibility IN ('draft', 'public', 'private', 'deleted')),
      usage_count INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      excerpt TEXT,
      content_markdown TEXT NOT NULL,
      content_html TEXT,
      cover_asset_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived', 'deleted')),
      visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
      seo_title TEXT,
      seo_description TEXT,
      reading_time_minutes INTEGER NOT NULL DEFAULT 1 CHECK (reading_time_minutes >= 1),
      word_count INTEGER NOT NULL DEFAULT 0 CHECK (word_count >= 0),
      published_at TEXT,
      pinned_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (cover_asset_id) REFERENCES assets(id) ON DELETE SET NULL
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      color TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS post_tags (
      post_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (post_id, tag_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS post_assets (
      post_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'inline' CHECK (role IN ('inline', 'cover')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (post_id, asset_id, role),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      user_agent TEXT,
      ip_hash TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'string' CHECK (type IN ('string', 'number', 'boolean', 'json')),
      updated_at TEXT NOT NULL
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      ip_hash TEXT,
      user_agent TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS friend_links (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      avatar_url TEXT,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'hidden', 'pending')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      health_status TEXT NOT NULL DEFAULT 'unknown',
      last_checked_at TEXT,
      last_status_code INTEGER,
      last_error TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS post_view_counts (
      post_id TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
      updated_at TEXT NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS rate_limits (
      scope TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      window_start TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope, key_hash, window_start)
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS sakura_schema_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
}

async function ensureColumns(db: D1Database): Promise<void> {
  await runIgnoringDuplicateColumn(db, 'ALTER TABLE users ADD COLUMN email TEXT');
  await runIgnoringDuplicateColumn(db, 'ALTER TABLE posts ADD COLUMN pinned_at TEXT');
  await runIgnoringDuplicateColumn(db, "ALTER TABLE friend_links ADD COLUMN health_status TEXT NOT NULL DEFAULT 'unknown'");
  await runIgnoringDuplicateColumn(db, 'ALTER TABLE friend_links ADD COLUMN last_checked_at TEXT');
  await runIgnoringDuplicateColumn(db, 'ALTER TABLE friend_links ADD COLUMN last_status_code INTEGER');
  await runIgnoringDuplicateColumn(db, 'ALTER TABLE friend_links ADD COLUMN last_error TEXT');
  await runIgnoringDuplicateColumn(db, 'ALTER TABLE friend_links ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0');
}

async function ensureIndexes(db: D1Database): Promise<void> {
  const indexes = [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)',
    'CREATE INDEX IF NOT EXISTS idx_assets_token ON assets(token)',
    'CREATE INDEX IF NOT EXISTS idx_assets_visibility ON assets(visibility)',
    'CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_assets_deleted_at ON assets(deleted_at)',
    'CREATE INDEX IF NOT EXISTS idx_assets_sha256 ON assets(sha256)',
    'CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug)',
    'CREATE INDEX IF NOT EXISTS idx_posts_public_lookup ON posts(status, visibility, deleted_at, published_at)',
    'CREATE INDEX IF NOT EXISTS idx_posts_status_published ON posts(status, published_at)',
    'CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_posts_deleted_at ON posts(deleted_at)',
    'CREATE INDEX IF NOT EXISTS idx_posts_pinned_at ON posts(pinned_at)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_revoked_at ON sessions(revoked_at)',
    'CREATE INDEX IF NOT EXISTS idx_post_tags_tag_id ON post_tags(tag_id)',
    'CREATE INDEX IF NOT EXISTS idx_post_assets_asset_id ON post_assets(asset_id)',
    'CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)',
    'CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id)',
    'CREATE INDEX IF NOT EXISTS idx_friend_links_status ON friend_links(status)',
    'CREATE INDEX IF NOT EXISTS idx_friend_links_sort_order ON friend_links(sort_order)',
    'CREATE INDEX IF NOT EXISTS idx_friend_links_created_at ON friend_links(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_friend_links_health_status ON friend_links(health_status)',
    'CREATE INDEX IF NOT EXISTS idx_friend_links_last_checked_at ON friend_links(last_checked_at)',
    'CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at ON rate_limits(expires_at)'
  ];

  for (const sql of indexes) {
    await run(db, sql);
  }
}

async function ensureDefaultSettings(db: D1Database): Promise<void> {
  const now = nowIso();
  const defaults: Array<[string, string]> = [
    ['friend_apply_enabled', 'false'],
    ['friend_health_enabled', 'false'],
    ['comment_enabled', 'false'],
    ['comment_provider', 'off'],
    ['comment_config', '{}'],
    ['view_count_enabled', 'false'],
    ['favicon_url', ''],
    ['maintenance_last_run_at', '']
  ];

  for (const [key, value] of defaults) {
    await db
      .prepare('INSERT OR IGNORE INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)')
      .bind(key, value, now)
      .run();
  }
}

async function createSchema(db: D1Database): Promise<void> {
  await ensureTables(db);
  await ensureColumns(db);
  await ensureIndexes(db);
  await ensureDefaultSettings(db);
  await db
    .prepare(
      `INSERT INTO sakura_schema_state (id, version, updated_at)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at`
    )
    .bind(CURRENT_SCHEMA_VERSION, nowIso())
    .run();
}

async function isSchemaCurrent(db: D1Database): Promise<boolean> {
  try {
    const row = await db
      .prepare('SELECT version FROM sakura_schema_state WHERE id = 1 LIMIT 1')
      .first<{ version: number }>();
    return row?.version === CURRENT_SCHEMA_VERSION;
  } catch {
    return false;
  }
}

export async function ensureD1Schema(db: D1Database): Promise<void> {
  schemaPromise ??= (async () => {
    if (!(await isSchemaCurrent(db))) {
      await createSchema(db);
    }
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}
