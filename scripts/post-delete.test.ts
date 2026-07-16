import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

type SqlValue = string | number | bigint | null | Uint8Array;

class SqliteD1Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly query: string,
    private readonly values: SqlValue[] = []
  ) {}

  bind(...values: SqlValue[]) {
    return new SqliteD1Statement(this.db, this.query, values);
  }

  async run() {
    const result = this.db.prepare(this.query).run(...this.values);
    return {
      success: true,
      meta: {
        changes: result.changes,
        last_row_id: Number(result.lastInsertRowid)
      }
    };
  }

  async first<T>() {
    return (this.db.prepare(this.query).get(...this.values) ?? null) as T | null;
  }

  async all<T>() {
    return {
      success: true,
      meta: {},
      results: this.db.prepare(this.query).all(...this.values) as T[]
    };
  }
}

class SqliteD1Database {
  constructor(readonly db: DatabaseSync) {}

  prepare(query: string) {
    return new SqliteD1Statement(this.db, query);
  }

  async batch(statements: SqliteD1Statement[]) {
    const results = [];
    this.db.exec('BEGIN');

    try {
      for (const statement of statements) {
        results.push(await statement.run());
      }

      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

class FakeR2Bucket {
  readonly deletedKeys: string[] = [];

  constructor(private readonly failKeys = new Set<string>()) {}

  async delete(key: string) {
    if (this.failKeys.has(key)) {
      throw new Error(`R2 delete failed for ${key}`);
    }

    this.deletedKeys.push(key);
  }
}

const now = '2026-01-01T00:00:00.000Z';
const exclusiveToken = 'A'.repeat(24);
const sharedToken = 'B'.repeat(24);
const coverExclusiveToken = 'C'.repeat(24);
const coverSharedToken = 'D'.repeat(24);

function setTestEnv(db: SqliteD1Database, bucket: FakeR2Bucket): void {
  const env = ((globalThis as Record<string, unknown>).__cloudflareWorkersEnv ??= {}) as Record<string, unknown>;
  env.DB = db as unknown as D1Database;
  env.MEDIA_BUCKET = bucket as unknown as R2Bucket;
}

async function captureConsoleError<T>(test: (entries: unknown[][]) => Promise<T>): Promise<T> {
  const originalConsoleError = console.error;
  const entries: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    entries.push(args);
  };

  try {
    return await test(entries);
  } finally {
    console.error = originalConsoleError;
  }
}

function createServiceDb(): SqliteD1Database {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(`
    CREATE TABLE users (
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
    );

    CREATE TABLE assets (
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
    );

    CREATE TABLE posts (
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

    CREATE TABLE tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      color TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE post_tags (
      post_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (post_id, tag_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE post_assets (
      post_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'inline' CHECK (role IN ('inline', 'cover')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (post_id, asset_id, role),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE post_view_counts (
      post_id TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
      updated_at TEXT NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );
  `);

  db.prepare(
    `INSERT INTO users (id, username, email, display_name, password_hash, role, status, created_at, updated_at, last_login_at)
     VALUES ('u1', 'admin', NULL, NULL, 'hash', 'admin', 'active', ?, ?, NULL)`
  ).run(now, now);

  db.prepare(
    `INSERT INTO assets (
      id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
      visibility, usage_count, created_by, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, 'image/png', 10, NULL, NULL, NULL, 'public', ?, 'u1', ?, ?, NULL)`
  ).run('asset-exclusive', exclusiveToken, 'r2-exclusive', 'exclusive.png', 1, now, now);
  db.prepare(
    `INSERT INTO assets (
      id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
      visibility, usage_count, created_by, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, 'image/png', 10, NULL, NULL, NULL, 'public', ?, 'u1', ?, ?, NULL)`
  ).run('asset-shared', sharedToken, 'r2-shared', 'shared.png', 2, now, now);
  db.prepare(
    `INSERT INTO assets (
      id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
      visibility, usage_count, created_by, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, 'image/png', 10, NULL, NULL, NULL, 'public', ?, 'u1', ?, ?, NULL)`
  ).run('asset-cover-exclusive', coverExclusiveToken, 'r2-cover-exclusive', 'cover-exclusive.png', 1, now, now);
  db.prepare(
    `INSERT INTO assets (
      id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
      visibility, usage_count, created_by, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, 'image/png', 10, NULL, NULL, NULL, 'public', ?, 'u1', ?, ?, NULL)`
  ).run('asset-cover-shared', coverSharedToken, 'r2-cover-shared', 'cover-shared.png', 2, now, now);
  db.prepare(
    `INSERT INTO assets (
      id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
      visibility, usage_count, created_by, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, 'image/png', 10, NULL, NULL, NULL, 'public', ?, 'u1', ?, ?, NULL)`
  ).run('asset-about-exclusive', 'E'.repeat(24), 'r2-about-exclusive', 'about-exclusive.png', 1, now, now);

  const insertPost = db.prepare(
    `INSERT INTO posts (
      id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
      seo_title, seo_description, reading_time_minutes, word_count, published_at, pinned_at, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, 'public', ?, NULL, 1, 1, ?, NULL, ?, ?)`
  );
  insertPost.run(
    'p-delete',
    'doomed',
    'Doomed',
    `![one](asset:${exclusiveToken})\n![two](asset:${sharedToken})`,
    null,
    'published',
    'Doomed',
    now,
    now,
    now
  );
  insertPost.run('p-shared', 'shared-post', 'Shared', `![two](asset:${sharedToken})`, null, 'published', 'Shared', now, now, now);
  insertPost.run('p-update', 'update-post', 'Update', 'published body', null, 'published', 'Update', now, now, now);
  insertPost.run('p-published', 'published-post', 'Published', 'published body', null, 'published', 'Published', now, now, now);
  insertPost.run(
    'p-cover-delete',
    'cover-delete',
    'Cover Delete',
    'cover only',
    'asset-cover-exclusive',
    'published',
    'Cover Delete',
    now,
    now,
    now
  );
  insertPost.run(
    'p-cover-shared-delete',
    'cover-shared-delete',
    'Cover Shared Delete',
    'shared cover',
    'asset-cover-shared',
    'published',
    'Cover Shared Delete',
    now,
    now,
    now
  );
  insertPost.run(
    'p-cover-shared-other',
    'cover-shared-other',
    'Cover Shared Other',
    'shared cover still used',
    'asset-cover-shared',
    'published',
    'Cover Shared Other',
    now,
    now,
    now
  );

  db.prepare('INSERT INTO tags (id, name, slug, color, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)').run(
    'tag1',
    'Test',
    'test',
    now,
    now
  );
  db.prepare('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)').run('p-delete', 'tag1');
  db.prepare('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)').run('p-shared', 'tag1');
  db.prepare("INSERT INTO post_assets (post_id, asset_id, role, created_at) VALUES (?, ?, 'inline', ?)").run(
    'p-delete',
    'asset-exclusive',
    now
  );
  db.prepare("INSERT INTO post_assets (post_id, asset_id, role, created_at) VALUES (?, ?, 'inline', ?)").run(
    'p-delete',
    'asset-shared',
    now
  );
  db.prepare("INSERT INTO post_assets (post_id, asset_id, role, created_at) VALUES (?, ?, 'inline', ?)").run(
    'p-shared',
    'asset-shared',
    now
  );
  db.prepare('INSERT INTO post_view_counts (post_id, count, updated_at) VALUES (?, 12, ?)').run('p-delete', now);

  return new SqliteD1Database(db);
}

function countRows(db: DatabaseSync, sql: string, ...values: SqlValue[]): number {
  return Number((db.prepare(sql).get(...values) as { count: number }).count);
}

function sortedAssetIds(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`SELECT asset_id FROM ${table} ORDER BY asset_id ASC`).all() as Array<{ asset_id: string }>).map(
    (row) => row.asset_id
  );
}

async function testPostDeleteService(): Promise<void> {
  const sqliteD1 = createServiceDb();
  const bucket = new FakeR2Bucket();
  setTestEnv(sqliteD1, bucket);

  const service = await import('../src/features/posts/post.service.ts');

  const deletedPost = await service.deleteAdminPost('p-delete');
  assert.equal(deletedPost?.id, 'p-delete');
  assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM posts WHERE id = ?', 'p-delete'), 0);
  assert.equal(await service.getAdminPost('p-delete'), null);
  assert.equal(await service.getAdminPostBySlug('doomed'), null);
  assert.equal(await service.getPublicPostBySlug('doomed'), null);
  assert.equal((await service.getAdminPosts()).some((post) => post.id === 'p-delete'), false);
  assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM post_tags WHERE post_id = ?', 'p-delete'), 0);
  assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM post_assets WHERE post_id = ?', 'p-delete'), 0);
  assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM post_view_counts WHERE post_id = ?', 'p-delete'), 0);
  assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM tags WHERE id = ?', 'tag1'), 1);

  assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM assets WHERE id = ?', 'asset-exclusive'), 0);
  assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM assets WHERE id = ?', 'asset-shared'), 1);
  assert.deepEqual(bucket.deletedKeys, ['r2-exclusive']);
  assert.equal(
    (sqliteD1.db.prepare('SELECT usage_count FROM assets WHERE id = ?').get('asset-shared') as { usage_count: number }).usage_count,
    1
  );

  const deletedCoverPost = await service.deleteAdminPost('p-cover-delete');
  assert.equal(deletedCoverPost?.id, 'p-cover-delete');
  assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM posts WHERE id = ?', 'p-cover-delete'), 0);
  assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM assets WHERE id = ?', 'asset-cover-exclusive'), 0);
  assert.deepEqual(bucket.deletedKeys, ['r2-exclusive', 'r2-cover-exclusive']);

  const deletedSharedCoverPost = await service.deleteAdminPost('p-cover-shared-delete');
  assert.equal(deletedSharedCoverPost?.id, 'p-cover-shared-delete');
  assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM posts WHERE id = ?', 'p-cover-shared-delete'), 0);
  assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM assets WHERE id = ?', 'asset-cover-shared'), 1);
  assert.equal(bucket.deletedKeys.includes('r2-cover-shared'), false);
  assert.equal(
    (sqliteD1.db.prepare('SELECT usage_count FROM assets WHERE id = ?').get('asset-cover-shared') as { usage_count: number }).usage_count,
    1
  );

  assert.equal(await service.deleteAdminPost('missing-post'), null);

  const updated = await service.updateAdminPost('p-update', {
    title: 'Published Updated',
    excerpt: '',
    contentMarkdown: 'still the same published row',
    status: 'published',
    visibility: 'public',
    tags: ''
  });
  assert.equal(updated?.id, 'p-update');
  assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM posts WHERE id = ?', 'p-update'), 1);
  assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM posts WHERE slug = ?', 'update-post'), 1);

  assert.ok(await service.getAdminPost('p-update'));
  assert.ok(await service.getPublicPostBySlug('published-post'));

  await assert.rejects(
    () =>
      service.createAdminPost({
        title: 'Draft should fail',
        contentMarkdown: 'body',
        status: 'draft',
        visibility: 'public'
      }),
    /Invalid post status/
  );
  await assert.rejects(
    () =>
      service.createAdminPost({
        title: 'Archived should fail',
        contentMarkdown: 'body',
        status: 'archived',
        visibility: 'public'
      }),
    /Invalid post status/
  );
  await assert.rejects(
    () =>
      service.createAdminPost({
        title: 'Private should fail',
        contentMarkdown: 'body',
        status: 'published',
        visibility: 'private'
      }),
    /Invalid post visibility/
  );

  const aboutFirst = await service.saveAdminAboutPost({
    title: 'About',
    excerpt: '',
    contentMarkdown: `about body ![about](asset:${'E'.repeat(24)})`,
    status: 'published',
    visibility: 'public',
    tags: ''
  });
  assert.equal(aboutFirst.slug, 'about');
  assert.equal(aboutFirst.status, 'published');
  assert.equal(countRows(sqliteD1.db, "SELECT COUNT(*) AS count FROM posts WHERE slug = 'about'"), 1);

  const aboutSecond = await service.saveAdminAboutPost({
    title: 'About Updated',
    excerpt: '',
    contentMarkdown: `updated about body ![about](asset:${'E'.repeat(24)})`,
    status: 'published',
    visibility: 'public',
    tags: ''
  });
  assert.equal(aboutSecond.id, aboutFirst.id);
  assert.equal(countRows(sqliteD1.db, "SELECT COUNT(*) AS count FROM posts WHERE slug = 'about'"), 1);

  const deletedAbout = await service.deleteAdminPost(aboutFirst.id);
  assert.equal(deletedAbout?.id, aboutFirst.id);
  assert.equal(countRows(sqliteD1.db, "SELECT COUNT(*) AS count FROM posts WHERE slug = 'about'"), 0);
  assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM assets WHERE id = ?', 'asset-about-exclusive'), 0);
  assert.equal(bucket.deletedKeys.includes('r2-about-exclusive'), true);
}

async function testDeleteApiSucceedsWhenR2CleanupFails(): Promise<void> {
  const sqliteD1 = createServiceDb();
  const bucket = new FakeR2Bucket(new Set(['r2-exclusive']));
  setTestEnv(sqliteD1, bucket);
  const api = await import('../src/pages/api/admin/posts/[id].ts');

  await captureConsoleError(async (entries) => {
    const response = await api.DELETE({ params: { id: 'p-delete' } } as never);
    const payload = (await response.json()) as { ok: boolean; data?: { post?: { id: string } } };

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.data?.post?.id, 'p-delete');
    assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM posts WHERE id = ?', 'p-delete'), 0);
    assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM assets WHERE id = ?', 'asset-exclusive'), 1);
    assert.equal(bucket.deletedKeys.includes('r2-exclusive'), false);

    const contextualLog = entries.find(
      ([scope, details]) =>
        scope === 'Post hard-delete asset cleanup failed.' &&
        typeof details === 'object' &&
        details !== null &&
        (details as Record<string, unknown>).postId === 'p-delete' &&
        (details as Record<string, unknown>).assetId === 'asset-exclusive' &&
        (details as Record<string, unknown>).r2Key === 'r2-exclusive' &&
        String((details as Record<string, unknown>).message).includes('R2 delete failed')
    );
    assert.ok(contextualLog);
  });
}

function createHistoricalCandidateCleanupDb(): SqliteD1Database {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(`
    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      r2_key TEXT NOT NULL UNIQUE
    );

    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      cover_asset_id TEXT,
      FOREIGN KEY (cover_asset_id) REFERENCES assets(id) ON DELETE SET NULL
    );

    CREATE TABLE post_assets (
      post_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'inline',
      created_at TEXT NOT NULL,
      PRIMARY KEY (post_id, asset_id, role),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE historical_post_asset_cleanup_candidates (
      asset_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );
  `);

  for (const [assetId, r2Key] of [
    ['asset-delete', 'r2-delete'],
    ['asset-shared', 'r2-shared'],
    ['asset-cover-shared', 'r2-cover-shared'],
    ['asset-fail', 'r2-fail'],
    ['asset-temp', 'r2-temp']
  ]) {
    db.prepare('INSERT INTO assets (id, r2_key) VALUES (?, ?)').run(assetId, r2Key);
  }

  db.prepare('INSERT INTO posts (id, cover_asset_id) VALUES (?, NULL)').run('p-shared');
  db.prepare('INSERT INTO posts (id, cover_asset_id) VALUES (?, ?)').run('p-cover-shared', 'asset-cover-shared');
  db.prepare("INSERT INTO post_assets (post_id, asset_id, role, created_at) VALUES (?, ?, 'inline', ?)").run(
    'p-shared',
    'asset-shared',
    now
  );

  for (const assetId of ['asset-delete', 'asset-shared', 'asset-cover-shared', 'asset-fail']) {
    db.prepare('INSERT INTO historical_post_asset_cleanup_candidates (asset_id, created_at) VALUES (?, ?)').run(assetId, now);
  }

  return new SqliteD1Database(db);
}

async function testHistoricalPostAssetCandidateCleanup(): Promise<void> {
  const { cleanupHistoricalPostAssetCandidates } = await import('./cleanup-historical-post-assets.ts');
  const sqliteD1 = createHistoricalCandidateCleanupDb();
  const failingBucket = new FakeR2Bucket(new Set(['r2-fail']));

  await captureConsoleError(async (entries) => {
    const stats = await cleanupHistoricalPostAssetCandidates(sqliteD1 as never, failingBucket, { limit: 20 });

    assert.deepEqual(stats, {
      scanned: 4,
      deleted: 1,
      skippedReferenced: 2,
      missingAsset: 0,
      failed: 1
    });
    assert.deepEqual(failingBucket.deletedKeys, ['r2-delete']);
    assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM assets WHERE id = ?', 'asset-delete'), 0);
    assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM assets WHERE id = ?', 'asset-shared'), 1);
    assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM assets WHERE id = ?', 'asset-cover-shared'), 1);
    assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM assets WHERE id = ?', 'asset-temp'), 1);
    assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM assets WHERE id = ?', 'asset-fail'), 1);
    assert.deepEqual(sortedAssetIds(sqliteD1.db, 'historical_post_asset_cleanup_candidates'), ['asset-fail']);
    assert.ok(
      entries.some(
        ([scope, details]) =>
          scope === 'Historical post asset cleanup failed.' &&
          typeof details === 'object' &&
          details !== null &&
          (details as Record<string, unknown>).assetId === 'asset-fail' &&
          (details as Record<string, unknown>).r2Key === 'r2-fail'
      )
    );
  });

  const retryBucket = new FakeR2Bucket();
  assert.deepEqual(await cleanupHistoricalPostAssetCandidates(sqliteD1 as never, retryBucket, { limit: 20 }), {
    scanned: 1,
    deleted: 1,
    skippedReferenced: 0,
    missingAsset: 0,
    failed: 0
  });
  assert.deepEqual(retryBucket.deletedKeys, ['r2-fail']);
  assert.equal(countRows(sqliteD1.db, 'SELECT COUNT(*) AS count FROM assets WHERE id = ?', 'asset-fail'), 0);
  assert.deepEqual(sortedAssetIds(sqliteD1.db, 'historical_post_asset_cleanup_candidates'), []);

  assert.deepEqual(await cleanupHistoricalPostAssetCandidates(sqliteD1 as never, retryBucket, { limit: 20 }), {
    scanned: 0,
    deleted: 0,
    skippedReferenced: 0,
    missingAsset: 0,
    failed: 0
  });
}

function testPostHardDeleteMigration(): void {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(`
    CREATE TABLE assets (id TEXT PRIMARY KEY);
    CREATE TABLE posts (
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
    );
    CREATE TABLE post_tags (
      post_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (post_id, tag_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );
    CREATE TABLE post_assets (
      post_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'inline' CHECK (role IN ('inline', 'cover')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (post_id, asset_id, role),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );
    CREATE TABLE post_view_counts (
      post_id TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
      updated_at TEXT NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );
    CREATE TABLE sakura_schema_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_posts_public_lookup ON posts(status, visibility, deleted_at, published_at);
    CREATE INDEX idx_posts_deleted_at ON posts(deleted_at);
  `);
  for (const assetId of ['asset-cover', 'asset1', 'asset-cover-deleted', 'asset-shared-history', 'asset-temp']) {
    db.prepare('INSERT INTO assets (id) VALUES (?)').run(assetId);
  }

  const insertPost = db.prepare(
    `INSERT INTO posts (
      id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
      seo_title, seo_description, reading_time_minutes, word_count, published_at, pinned_at, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, NULL, 'body', NULL, NULL, ?, 'public', NULL, NULL, 1, 1, ?, NULL, ?, ?, ?)`
  );
  insertPost.run('p-live', 'live', 'Live', 'published', now, now, now, null);
  insertPost.run('p-draft', 'draft', 'Draft', 'draft', null, now, now, null);
  insertPost.run('p-archived', 'archived', 'Archived', 'archived', null, now, now, null);
  db.prepare(
    `INSERT INTO posts (
      id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
      seo_title, seo_description, reading_time_minutes, word_count, published_at, pinned_at, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, NULL, 'body', NULL, ?, 'published', 'public', NULL, NULL, 1, 1, ?, NULL, ?, ?, NULL)`
  ).run('p-cover', 'cover', 'Cover', 'asset-cover', now, now, now);
  db.prepare(
    `INSERT INTO posts (
      id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
      seo_title, seo_description, reading_time_minutes, word_count, published_at, pinned_at, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, NULL, 'body', NULL, ?, 'draft', 'public', NULL, NULL, 1, 1, NULL, NULL, ?, ?, ?)`
  ).run('p-cover-deleted', 'cover-deleted', 'Cover Deleted', 'asset-cover-deleted', now, now, now);
  insertPost.run('p-status-deleted', 'status-deleted', 'Deleted', 'deleted', null, now, now, null);
  insertPost.run('p-deleted-at', 'deleted-at', 'Deleted At', 'draft', null, now, now, now);
  db.prepare('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)').run('p-status-deleted', 'tag1');
  db.prepare("INSERT INTO post_assets (post_id, asset_id, role, created_at) VALUES (?, ?, 'inline', ?)").run(
    'p-deleted-at',
    'asset1',
    now
  );
  db.prepare("INSERT INTO post_assets (post_id, asset_id, role, created_at) VALUES (?, ?, 'inline', ?)").run(
    'p-deleted-at',
    'asset-shared-history',
    now
  );
  db.prepare("INSERT INTO post_assets (post_id, asset_id, role, created_at) VALUES (?, ?, 'inline', ?)").run(
    'p-live',
    'asset-shared-history',
    now
  );
  db.prepare('INSERT INTO post_view_counts (post_id, count, updated_at) VALUES (?, 1, ?)').run('p-deleted-at', now);

  const migrationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations/0009_hard_delete_posts.sql');
  db.exec(readFileSync(migrationPath, 'utf8'));

  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM posts WHERE id = ?', 'p-live'), 1);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM posts WHERE id = ?', 'p-draft'), 1);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM posts WHERE id = ? AND status = ?', 'p-archived', 'archived'), 1);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM posts WHERE id = ?', 'p-status-deleted'), 0);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM posts WHERE id = ?', 'p-deleted-at'), 0);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM posts WHERE id = ?', 'p-cover-deleted'), 0);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM post_tags WHERE post_id = ?', 'p-status-deleted'), 0);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM post_assets WHERE post_id = ?', 'p-deleted-at'), 0);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM post_view_counts WHERE post_id = ?', 'p-deleted-at'), 0);
  assert.deepEqual(sortedAssetIds(db, 'historical_post_asset_cleanup_candidates'), [
    'asset-cover-deleted',
    'asset-shared-history',
    'asset1'
  ]);
  assert.equal(
    countRows(db, 'SELECT COUNT(*) AS count FROM historical_post_asset_cleanup_candidates WHERE asset_id = ?', 'asset-temp'),
    0
  );

  const postColumns = db.prepare('PRAGMA table_info(posts)').all() as Array<{ name: string }>;
  assert.equal(postColumns.some((column) => column.name === 'deleted_at'), false);
  assert.deepEqual(
    postColumns.map((column) => column.name),
    [
      'id',
      'slug',
      'title',
      'excerpt',
      'content_markdown',
      'content_html',
      'cover_asset_id',
      'status',
      'visibility',
      'seo_title',
      'seo_description',
      'reading_time_minutes',
      'word_count',
      'published_at',
      'pinned_at',
      'created_at',
      'updated_at'
    ]
  );

  const postsSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'posts'").get() as { sql: string }).sql;
  assert.match(postsSql, /id TEXT PRIMARY KEY/);
  assert.match(postsSql, /slug TEXT NOT NULL UNIQUE/);
  assert.match(postsSql, /status TEXT NOT NULL DEFAULT 'draft' CHECK \(status IN \('draft', 'published', 'archived'\)\)/);
  assert.match(postsSql, /visibility TEXT NOT NULL DEFAULT 'public' CHECK \(visibility IN \('public', 'private'\)\)/);
  assert.match(postsSql, /reading_time_minutes INTEGER NOT NULL DEFAULT 1 CHECK \(reading_time_minutes >= 1\)/);
  assert.match(postsSql, /word_count INTEGER NOT NULL DEFAULT 0 CHECK \(word_count >= 0\)/);
  assert.match(postsSql, /created_at TEXT NOT NULL/);
  assert.match(postsSql, /updated_at TEXT NOT NULL/);
  assert.match(postsSql, /FOREIGN KEY \(cover_asset_id\) REFERENCES assets\(id\) ON DELETE SET NULL/);

  const indexNames = new Set((db.prepare('PRAGMA index_list(posts)').all() as Array<{ name: string }>).map((index) => index.name));
  assert.equal(indexNames.has('idx_posts_slug'), true);
  assert.equal(indexNames.has('idx_posts_public_lookup'), true);
  assert.equal(indexNames.has('idx_posts_status_published'), true);
  assert.equal(indexNames.has('idx_posts_created_at'), true);
  assert.equal(indexNames.has('idx_posts_pinned_at'), true);
  assert.equal(indexNames.has('idx_posts_deleted_at'), false);

  const publicLookupColumns = db.prepare('PRAGMA index_info(idx_posts_public_lookup)').all() as Array<{ name: string }>;
  assert.deepEqual(publicLookupColumns.map((column) => column.name), ['status', 'visibility', 'published_at']);
  const statusPublishedColumns = db.prepare('PRAGMA index_info(idx_posts_status_published)').all() as Array<{ name: string }>;
  assert.deepEqual(statusPublishedColumns.map((column) => column.name), ['status', 'published_at']);

  const postsForeignKeys = db.prepare('PRAGMA foreign_key_list(posts)').all() as Array<{ table: string; from: string; to: string; on_delete: string }>;
  assert.ok(
    postsForeignKeys.some(
      (foreignKey) =>
        foreignKey.table === 'assets' &&
        foreignKey.from === 'cover_asset_id' &&
        foreignKey.to === 'id' &&
        foreignKey.on_delete === 'SET NULL'
    )
  );

  for (const childTable of ['post_tags', 'post_assets', 'post_view_counts']) {
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${childTable})`).all() as Array<{
      table: string;
      from: string;
      to: string;
      on_delete: string;
    }>;
    assert.ok(
      foreignKeys.some(
        (foreignKey) =>
          foreignKey.table === 'posts' &&
          foreignKey.from === 'post_id' &&
          foreignKey.to === 'id' &&
          foreignKey.on_delete === 'CASCADE'
      ),
      `${childTable} should still cascade to posts(id)`
    );
  }

  assert.throws(() => db.prepare('INSERT INTO post_view_counts (post_id, count, updated_at) VALUES (?, 1, ?)').run('missing', now));
  db.prepare('DELETE FROM assets WHERE id = ?').run('asset-cover');
  assert.equal((db.prepare('SELECT cover_asset_id FROM posts WHERE id = ?').get('p-cover') as { cover_asset_id: string | null }).cover_asset_id, null);

  assert.throws(() => {
    db.prepare(
      `INSERT INTO posts (
        id, slug, title, content_markdown, status, visibility, reading_time_minutes,
        word_count, created_at, updated_at
      ) VALUES ('p-new-deleted', 'new-deleted', 'New Deleted', 'body', 'deleted', 'public', 1, 1, ?, ?)`
    ).run(now, now);
  });
  assert.equal((db.prepare('SELECT version FROM sakura_schema_state WHERE id = 1').get() as { version: number }).version, 9);
}

function testSimplifyPostStatusMigration(): void {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

  for (const migration of [
    '0001_init.sql',
    '0002_add_user_email.sql',
    '0003_add_assets_sha256_index.sql',
    '0004_add_post_pinned_at.sql',
    '0005_create_friend_links.sql',
    '0006_site_settings_controls.sql',
    '0007_friend_health_and_view_api.sql',
    '0008_security_hardening.sql',
    '0009_hard_delete_posts.sql'
  ]) {
    db.exec(readFileSync(path.join(migrationsDir, migration), 'utf8'));
  }

  db.prepare(
    `INSERT INTO users (id, username, email, display_name, password_hash, role, status, created_at, updated_at, last_login_at)
     VALUES ('u1', 'admin', 'admin@example.com', NULL, 'hash', 'admin', 'active', ?, ?, NULL)`
  ).run(now, now);

  for (const [id, token, r2Key] of [
    ['asset-live', 'L'.repeat(24), 'r2-live'],
    ['asset-about', 'M'.repeat(24), 'r2-about'],
    ['asset-draft-inline', 'N'.repeat(24), 'r2-draft-inline'],
    ['asset-draft-cover', 'O'.repeat(24), 'r2-draft-cover'],
    ['asset-archived-inline', 'P'.repeat(24), 'r2-archived-inline'],
    ['asset-private-inline', 'Q'.repeat(24), 'r2-private-inline'],
    ['asset-shared-history', 'R'.repeat(24), 'r2-shared-history'],
    ['asset-temp', 'S'.repeat(24), 'r2-temp']
  ]) {
    db.prepare(
      `INSERT INTO assets (
        id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
        visibility, usage_count, created_by, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, 'image/png', 10, NULL, NULL, ?, 'public', 0, 'u1', ?, ?, NULL)`
    ).run(id, token, r2Key, `${id}.png`, id, now, now);
  }

  db.prepare('INSERT INTO tags (id, name, slug, color, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)').run(
    'tag1',
    'Tag',
    'tag',
    now,
    now
  );

  const insertPost = db.prepare(
    `INSERT INTO posts (
      id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
      seo_title, seo_description, reading_time_minutes, word_count, published_at, pinned_at, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, ?, NULL, NULL, 1, 1, ?, NULL, ?, ?)`
  );
  insertPost.run('p-live', 'live', 'Live', `![live](asset:${'L'.repeat(24)})`, null, 'published', 'public', now, now, now);
  insertPost.run('p-about', 'about', 'About', `![about](asset:${'M'.repeat(24)})`, null, 'published', 'public', now, now, now);
  insertPost.run('p-draft', 'draft', 'Draft', `![draft](asset:${'N'.repeat(24)})`, 'asset-draft-cover', 'draft', 'public', null, now, now);
  insertPost.run('p-draft-about', 'about-draft', 'About Draft', 'draft about', null, 'draft', 'public', null, now, now);
  insertPost.run(
    'p-archived',
    'archived',
    'Archived',
    `![archived](asset:${'P'.repeat(24)})\n![shared](asset:${'R'.repeat(24)})`,
    null,
    'archived',
    'public',
    null,
    now,
    now
  );
  insertPost.run('p-private', 'private', 'Private', `![private](asset:${'Q'.repeat(24)})`, null, 'published', 'private', now, now, now);

  for (const postId of ['p-live', 'p-about', 'p-draft', 'p-archived', 'p-private']) {
    db.prepare('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)').run(postId, 'tag1');
    db.prepare('INSERT INTO post_view_counts (post_id, count, updated_at) VALUES (?, 1, ?)').run(postId, now);
  }
  for (const [postId, assetId] of [
    ['p-live', 'asset-live'],
    ['p-live', 'asset-shared-history'],
    ['p-about', 'asset-about'],
    ['p-draft', 'asset-draft-inline'],
    ['p-archived', 'asset-archived-inline'],
    ['p-archived', 'asset-shared-history'],
    ['p-private', 'asset-private-inline']
  ]) {
    db.prepare("INSERT INTO post_assets (post_id, asset_id, role, created_at) VALUES (?, ?, 'inline', ?)").run(postId, assetId, now);
  }

  db.exec(readFileSync(path.join(migrationsDir, '0010_simplify_post_status.sql'), 'utf8'));

  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM posts WHERE id = ?', 'p-live'), 1);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM posts WHERE id = ?', 'p-about'), 1);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM posts WHERE id = ?', 'p-draft'), 0);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM posts WHERE id = ?', 'p-draft-about'), 0);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM posts WHERE id = ?', 'p-archived'), 0);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM posts WHERE id = ?', 'p-private'), 0);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM post_tags WHERE post_id = ?', 'p-live'), 1);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM post_tags WHERE post_id = ?', 'p-about'), 1);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM post_assets WHERE post_id = ?', 'p-live'), 2);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM post_assets WHERE post_id = ?', 'p-about'), 1);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM post_view_counts WHERE post_id = ?', 'p-live'), 1);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM post_view_counts WHERE post_id = ?', 'p-about'), 1);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM post_tags WHERE post_id IN (?, ?, ?, ?)', 'p-draft', 'p-draft-about', 'p-archived', 'p-private'), 0);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM post_assets WHERE post_id IN (?, ?, ?, ?)', 'p-draft', 'p-draft-about', 'p-archived', 'p-private'), 0);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM post_view_counts WHERE post_id IN (?, ?, ?, ?)', 'p-draft', 'p-draft-about', 'p-archived', 'p-private'), 0);
  assert.deepEqual(sortedAssetIds(db, 'historical_post_asset_cleanup_candidates'), [
    'asset-archived-inline',
    'asset-draft-cover',
    'asset-draft-inline',
    'asset-private-inline',
    'asset-shared-history'
  ]);
  assert.equal(countRows(db, 'SELECT COUNT(*) AS count FROM historical_post_asset_cleanup_candidates WHERE asset_id = ?', 'asset-temp'), 0);

  const postsSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'posts'").get() as { sql: string }).sql;
  assert.match(postsSql, /status TEXT NOT NULL DEFAULT 'published' CHECK \(status IN \('published'\)\)/);
  assert.match(postsSql, /visibility TEXT NOT NULL DEFAULT 'public' CHECK \(visibility IN \('public'\)\)/);
  assert.match(postsSql, /slug TEXT NOT NULL UNIQUE/);
  assert.match(postsSql, /FOREIGN KEY \(cover_asset_id\) REFERENCES assets\(id\) ON DELETE SET NULL/);

  const indexNames = new Set((db.prepare('PRAGMA index_list(posts)').all() as Array<{ name: string }>).map((index) => index.name));
  assert.equal(indexNames.has('idx_posts_slug'), true);
  assert.equal(indexNames.has('idx_posts_public_lookup'), true);
  assert.equal(indexNames.has('idx_posts_status_published'), false);
  assert.equal(indexNames.has('idx_posts_created_at'), true);
  assert.equal(indexNames.has('idx_posts_pinned_at'), true);

  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
  assert.throws(() => {
    db.prepare(
      `INSERT INTO posts (
        id, slug, title, content_markdown, status, visibility, reading_time_minutes,
        word_count, published_at, created_at, updated_at
      ) VALUES ('p-new-draft', 'new-draft', 'New Draft', 'body', 'draft', 'public', 1, 1, ?, ?, ?)`
    ).run(now, now, now);
  });
  assert.throws(() => {
    db.prepare(
      `INSERT INTO posts (
        id, slug, title, content_markdown, status, visibility, reading_time_minutes,
        word_count, published_at, created_at, updated_at
      ) VALUES ('p-new-archived', 'new-archived', 'New Archived', 'body', 'archived', 'public', 1, 1, ?, ?, ?)`
    ).run(now, now, now);
  });
  assert.throws(() => {
    db.prepare(
      `INSERT INTO posts (
        id, slug, title, content_markdown, status, visibility, reading_time_minutes,
        word_count, published_at, created_at, updated_at
      ) VALUES ('p-new-deleted', 'new-deleted', 'New Deleted', 'body', 'deleted', 'public', 1, 1, ?, ?, ?)`
    ).run(now, now, now);
  });
  assert.throws(() => {
    db.prepare(
      `INSERT INTO posts (
        id, slug, title, content_markdown, status, visibility, reading_time_minutes,
        word_count, published_at, created_at, updated_at
      ) VALUES ('p-new-private', 'new-private', 'New Private', 'body', 'published', 'private', 1, 1, ?, ?, ?)`
    ).run(now, now, now);
  });
  assert.equal((db.prepare('SELECT version FROM sakura_schema_state WHERE id = 1').get() as { version: number }).version, 10);
}

function testPostEditorDeleteSuccessPath(): void {
  const editorPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/admin/PostEditor.tsx');
  const source = readFileSync(editorPath, 'utf8');
  const deletePostFunction = source.match(/async function deletePost\(\) \{[\s\S]*?\n  \}/)?.[0] ?? '';

  assert.match(deletePostFunction, /if \(!response\.ok\) \{[\s\S]*return;[\s\S]*\}/);
  assert.match(deletePostFunction, /cleanupUnsavedSessionUploads\(\);/);
  assert.match(deletePostFunction, /clearWriterAutosaveSnapshot\(getWriterAutosaveKey\(postId, aboutMode\)\);/);
  assert.match(deletePostFunction, /window\.location\.assign\(aboutMode \? '\/about\?fresh=1' : '\/articles'\);/);
}

function testPostLifecycleUiAndRoutes(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const writeSource = readFileSync(path.join(root, 'src/pages/write.astro'), 'utf8');
  const editorSource = readFileSync(path.join(root, 'src/components/admin/PostEditor.tsx'), 'utf8');
  const autosaveSource = readFileSync(path.join(root, 'src/components/admin/postEditorAutosave.ts'), 'utf8');
  const middlewareSource = readFileSync(path.join(root, 'src/middleware.ts'), 'utf8');
  const workerSource = readFileSync(path.join(root, 'src/worker.ts'), 'utf8');
  const migrationSource = readFileSync(path.join(root, 'migrations/0010_simplify_post_status.sql'), 'utf8');

  assert.doesNotMatch(writeSource, /ensureAdminAboutPost/);
  assert.match(writeSource, /getAdminAboutEditorPost/);
  assert.match(autosaveSource, /ABOUT_AUTOSAVE_KEY/);
  assert.match(editorSource, /getWriterAutosaveKey\(null, aboutMode\)/);
  assert.match(editorSource, /type: aboutMode \? 'about' : undefined/);
  assert.doesNotMatch(editorSource, /isCollected/);
  assert.throws(() => readFileSync(path.join(root, 'src/pages/api/admin/posts/[id]/unpublish.ts'), 'utf8'));
  assert.throws(() => readFileSync(path.join(root, 'src/pages/api/admin/posts/[id]/publish.ts'), 'utf8'));
  assert.throws(() => readFileSync(path.join(root, 'src/lib/schema.ts'), 'utf8'));
  assert.doesNotMatch(middlewareSource, /ensureD1Schema|createSchema|ensurePublishedOnlyPostSchema/);
  assert.doesNotMatch(workerSource, /ensureD1Schema|createSchema|ensurePublishedOnlyPostSchema/);
  assert.doesNotMatch(migrationSource, /\bBEGIN(?:\s+TRANSACTION)?\b/i);
  assert.doesNotMatch(migrationSource, /\bCOMMIT\b/i);
  assert.doesNotMatch(migrationSource, /\bROLLBACK\b/i);
  assert.doesNotMatch(migrationSource, /\bSAVEPOINT\b/i);
  assert.doesNotMatch(migrationSource, /PRAGMA\s+foreign_keys\s*=/i);
  assert.match(migrationSource, /PRAGMA\s+defer_foreign_keys\s*=\s*ON/i);
}

await testPostDeleteService();
await testDeleteApiSucceedsWhenR2CleanupFails();
await testHistoricalPostAssetCandidateCleanup();
testPostHardDeleteMigration();
testSimplifyPostStatusMigration();
testPostEditorDeleteSuccessPath();
testPostLifecycleUiAndRoutes();

console.log('Post hard-delete checks passed.');
