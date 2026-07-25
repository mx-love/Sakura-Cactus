import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  exportBlogData,
  getBlogDataSummary,
  importBlogDataFile,
  inspectBlogDataFile
} from '@/features/data-portability/data-portability.service';
import { createDataZip, parseDataZip } from '@/features/data-portability/data-portability.zip';
import { BLOG_DATA_FORMAT, BLOG_DATA_VERSION } from '@/features/data-portability/data-portability.constants';
import { SESSION_COOKIE_NAME } from '@/features/auth/auth.constants';
import { GET as getImageByToken } from '@/pages/i/[token]';
import { findAssetsByTokens } from '@/features/assets/asset.repo';
import { getDb } from '@/lib/db';

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
        changes: result.changes
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
  readonly objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  readonly deletedKeys: string[] = [];
  readonly putKeys: string[] = [];

  constructor(private readonly failPut = false) {}

  async get(key: string) {
    const object = this.objects.get(key);

    if (!object) {
      return null;
    }

    return {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(object.bytes);
          controller.close();
        }
      }),
      size: object.bytes.byteLength,
      httpEtag: `"${key}"`
    };
  }

  async put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) {
    if (this.failPut) {
      throw new Error(`R2 put failed for ${key}`);
    }

    this.putKeys.push(key);
    this.objects.set(key, {
      bytes: new Uint8Array(value.slice(0)),
      contentType: options?.httpMetadata?.contentType
    });
  }

  async delete(key: string) {
    this.deletedKeys.push(key);
    this.objects.delete(key);
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, '.tmp', 'data-portability-fixtures');
const now = '2026-01-01T00:00:00.000Z';
const sessionRequest = new Request('https://target.example/api/admin/data-portability/inspect', {
  headers: {
    cookie: `${SESSION_COOKIE_NAME}=test-session-token`
  }
});
const inlineToken = 'A'.repeat(24);
const coverToken = 'B'.repeat(24);
const tempToken = 'C'.repeat(24);
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const coverBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 5, 6, 7, 8]);

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function setTestEnv(db: SqliteD1Database, bucket: FakeR2Bucket): void {
  const env = ((globalThis as Record<string, unknown>).__cloudflareWorkersEnv ??= {}) as Record<string, unknown>;
  env.DB = db as unknown as D1Database;
  env.MEDIA_BUCKET = bucket as unknown as R2Bucket;
  env.ADMIN_USERNAME = 'admin';
  env.ADMIN_PASSWORD = 'local-test-password';
  env.SESSION_SECRET = 'local-test-session-secret-value-000000';
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytesToArrayBuffer(bytes));
  const output = new Uint8Array(digest);
  let binary = '';

  for (const byte of output) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function createDb(): SqliteD1Database {
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

    CREATE TABLE friend_links (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      avatar_url TEXT,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'hidden', 'pending')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      health_status TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('unknown', 'ok', 'warning', 'down')),
      last_checked_at TEXT,
      last_status_code INTEGER,
      last_error TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX idx_posts_public_lookup ON posts(status, visibility, published_at);
    CREATE INDEX idx_assets_sha256 ON assets(sha256);
  `);
  db.prepare(
    `INSERT INTO users (id, username, email, display_name, password_hash, role, status, created_at, updated_at, last_login_at)
     VALUES ('env_admin', 'admin', NULL, 'Admin', 'hash', 'admin', 'active', ?, ?, NULL)`
  ).run(now, now);
  return new SqliteD1Database(db);
}

async function seedSource(): Promise<{ d1: SqliteD1Database; bucket: FakeR2Bucket; inlineSha: string; coverSha: string }> {
  const d1 = createDb();
  const bucket = new FakeR2Bucket();
  const db = d1.db;
  const inlineSha = await sha256(pngBytes);
  const coverSha = await sha256(coverBytes);
  setTestEnv(d1, bucket);
  bucket.objects.set('r2-inline', { bytes: pngBytes, contentType: 'image/png' });
  bucket.objects.set('r2-cover', { bytes: coverBytes, contentType: 'image/png' });
  bucket.objects.set('r2-temp', { bytes: pngBytes, contentType: 'image/png' });
  db.prepare(
    `INSERT INTO assets (
      id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
      visibility, usage_count, created_by, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, 'image/png', ?, NULL, NULL, ?, 'public', ?, 'env_admin', ?, ?, NULL)`
  ).run('asset-inline', inlineToken, 'r2-inline', 'inline.png', pngBytes.byteLength, inlineSha, 1, now, now);
  db.prepare(
    `INSERT INTO assets (
      id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
      visibility, usage_count, created_by, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, 'image/png', ?, NULL, NULL, ?, 'public', ?, 'env_admin', ?, ?, NULL)`
  ).run('asset-cover', coverToken, 'r2-cover', 'cover.png', coverBytes.byteLength, coverSha, 1, now, now);
  db.prepare(
    `INSERT INTO assets (
      id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
      visibility, usage_count, created_by, created_at, updated_at, deleted_at
    ) VALUES ('asset-temp', ?, 'r2-temp', 'temp.png', 'image/png', ?, NULL, NULL, ?, 'draft', 0, 'env_admin', ?, ?, NULL)`
  ).run(tempToken, pngBytes.byteLength, inlineSha, now, now);
  db.prepare(
    `INSERT INTO posts (
      id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
      seo_title, seo_description, reading_time_minutes, word_count, published_at, pinned_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, '<p>old</p>', ?, 'published', 'public', ?, ?, 1, 10, ?, NULL, ?, ?)`
  ).run(
    'post-one',
    'hello-world',
    'Hello World',
    'Intro',
    `![inline](asset:${inlineToken})\n![temp](asset:${tempToken})\n![external](https://example.com/external.png)`,
    'asset-cover',
    'Hello SEO',
    'Intro SEO',
    now,
    now,
    now
  );
  db.prepare(
    `INSERT INTO posts (
      id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
      seo_title, seo_description, reading_time_minutes, word_count, published_at, pinned_at, created_at, updated_at
    ) VALUES ('post-about', 'about', 'About', NULL, 'About body', '<p>old</p>', NULL, 'published', 'public', NULL, NULL, 1, 2, ?, NULL, ?, ?)`
  ).run(now, now, now);
  db.prepare("INSERT INTO tags (id, name, slug, color, created_at, updated_at) VALUES ('tag-life', 'Life', 'life', NULL, ?, ?)").run(now, now);
  db.prepare("INSERT INTO tags (id, name, slug, color, created_at, updated_at) VALUES ('tag-unused', 'Unused', 'unused', NULL, ?, ?)").run(now, now);
  db.prepare("INSERT INTO post_tags (post_id, tag_id) VALUES ('post-one', 'tag-life')").run();
  db.prepare("INSERT INTO post_assets (post_id, asset_id, role, created_at) VALUES ('post-one', 'asset-inline', 'inline', ?)").run(now);
  db.prepare("INSERT INTO friend_links (id, name, url, avatar_url, description, status, sort_order, health_status, consecutive_failures, created_at, updated_at) VALUES ('fl-ok', 'Friend', 'https://www.wikipedia.org/', NULL, 'A friend', 'approved', 0, 'unknown', 0, ?, ?)").run(now, now);
  db.prepare("INSERT INTO friend_links (id, name, url, avatar_url, description, status, sort_order, health_status, consecutive_failures, created_at, updated_at) VALUES ('fl-hidden', 'Hidden', 'https://www.iana.org/', NULL, NULL, 'hidden', 0, 'unknown', 0, ?, ?)").run(now, now);
  return { d1, bucket, inlineSha, coverSha };
}

async function seedTargetMedia(d1: SqliteD1Database, bucket: FakeR2Bucket): Promise<void> {
  const inlineSha = await sha256(pngBytes);
  const coverSha = await sha256(coverBytes);
  bucket.objects.set('target-inline', { bytes: pngBytes, contentType: 'image/png' });
  bucket.objects.set('target-cover', { bytes: coverBytes, contentType: 'image/png' });
  bucket.objects.set('target-temp', { bytes: pngBytes, contentType: 'image/png' });
  d1.db
    .prepare(
      `INSERT INTO assets (
        id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
        visibility, usage_count, created_by, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, 'image/png', ?, NULL, NULL, ?, 'public', 0, 'env_admin', ?, ?, NULL)`
    )
    .run('target-inline', inlineToken, 'target-inline', 'inline.png', pngBytes.byteLength, inlineSha, now, now);
  d1.db
    .prepare(
      `INSERT INTO assets (
        id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
        visibility, usage_count, created_by, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, 'image/png', ?, NULL, NULL, ?, 'public', 0, 'env_admin', ?, ?, NULL)`
    )
    .run('target-cover', coverToken, 'target-cover', 'cover.png', coverBytes.byteLength, coverSha, now, now);
  d1.db
    .prepare(
      `INSERT INTO assets (
        id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
        visibility, usage_count, created_by, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, 'image/png', ?, NULL, NULL, ?, 'public', 0, 'env_admin', ?, ?, NULL)`
    )
    .run('target-temp', tempToken, 'target-temp', 'temp.png', pngBytes.byteLength, inlineSha, now, now);
}

function jsonFileFromBytes(bytes: Uint8Array, name = 'data.json'): File {
  return new File([bytesToArrayBuffer(bytes)], name, { type: 'application/json' });
}

function zipFileFromBytes(bytes: Uint8Array, name = 'data.zip'): File {
  return new File([bytesToArrayBuffer(bytes)], name, { type: 'application/zip' });
}

function parseJsonExport(bytes: Uint8Array): any {
  return JSON.parse(new TextDecoder().decode(bytes));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

async function finalizeFixtureData(value: any): Promise<any> {
  const { checksums: _ignored, ...unsigned } = value;
  return {
    ...unsigned,
    checksums: {
      contentSha256: await sha256(new TextEncoder().encode(stableStringify(unsigned)))
    }
  };
}

function countRows(db: DatabaseSync, sql: string, ...values: SqlValue[]): number {
  const row = db.prepare(sql).get(...values) as { count: number } | undefined;
  assert.ok(row);
  return row.count;
}

async function expectReject(label: string, test: () => Promise<unknown>): Promise<void> {
  let rejected = false;

  try {
    await test();
  } catch {
    rejected = true;
  }

  assert.equal(rejected, true, label);
}

async function inspectWithCurrentEnv(file: File) {
  return inspectBlogDataFile(file, sessionRequest);
}

async function testExportAndInspect(): Promise<{ jsonBytes: Uint8Array; zipBytes: Uint8Array }> {
  const { d1 } = await seedSource();
  const summary = await getBlogDataSummary();
  assert.deepEqual(summary, {
    publishedArticles: 2,
    usedTags: 1,
    referencedMedia: 2,
    friends: 1
  });
  const jsonExport = await exportBlogData({ articles: true, media: false, friends: false }, 'https://source.example');
  assert.equal(jsonExport.json, true);
  const data = parseJsonExport(jsonExport.bytes);
  assert.equal(data.format, BLOG_DATA_FORMAT);
  assert.equal(data.version, BLOG_DATA_VERSION);
  assert.equal(data.articles.length, 1);
  assert.equal(data.aboutPage.slug, 'about');
  assert.equal(data.tags.length, 1);
  assert.equal(data.manifest.counts.tags, summary.usedTags);
  assert.equal(data.manifest.counts.media, 3);
  assert.equal(data.friends, undefined);
  assert.equal(JSON.stringify(data).includes('content_html'), false);
  assert.equal(data.mediaManifest.length, 3);
  assert.equal(data.mediaManifest.some((entry: any) => entry.token === tempToken), true);
  const inspect = await inspectWithCurrentEnv(jsonFileFromBytes(jsonExport.bytes));
  assert.equal(inspect.ok, true);
  assert.equal(inspect.file.articles, 2);
  assert.equal(countRows(d1.db, 'SELECT COUNT(*) AS count FROM posts'), 2);
  const friendOnly = await exportBlogData({ articles: false, media: false, friends: true }, 'https://source.example');
  const friendData = parseJsonExport(friendOnly.bytes);
  assert.equal(friendData.articles.length, 0);
  assert.equal(friendData.friends.length, 1);
  const zipExport = await exportBlogData({ articles: true, media: true, friends: true }, 'https://source.example');
  assert.equal(zipExport.json, false);
  const files = parseDataZip(bytesToArrayBuffer(zipExport.bytes));
  assert.ok(files.some((file) => file.path === 'data.json'));
  assert.equal(files.filter((file) => file.path.startsWith('media/')).length, 3);
  return { jsonBytes: jsonExport.bytes, zipBytes: zipExport.bytes };
}

function insertSummaryPost(
  db: DatabaseSync,
  id: string,
  slug: string,
  status = 'published',
  visibility = 'public'
): void {
  db.prepare(
    `INSERT INTO posts (
      id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
      seo_title, seo_description, reading_time_minutes, word_count, published_at, pinned_at, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, 'body', NULL, NULL, ?, ?, NULL, NULL, 1, 1, ?, NULL, ?, ?)`
  ).run(id, slug, slug, status, visibility, now, now, now);
}

async function testSummaryTagCounts(): Promise<void> {
  const d1 = createDb();
  setTestEnv(d1, new FakeR2Bucket());
  const db = d1.db;

  for (let index = 1; index <= 21; index += 1) {
    insertSummaryPost(db, `post-${index}`, `post-${index}`);
  }

  const noTagSummary = await getBlogDataSummary();
  assert.equal(noTagSummary.publishedArticles, 21);
  assert.equal(noTagSummary.usedTags, 0);

  db.prepare("INSERT INTO tags (id, name, slug, color, created_at, updated_at) VALUES ('tag-shared', 'Shared', 'shared', NULL, ?, ?)").run(now, now);
  db.prepare("INSERT INTO post_tags (post_id, tag_id) VALUES ('post-1', 'tag-shared')").run();
  db.prepare("INSERT INTO post_tags (post_id, tag_id) VALUES ('post-2', 'tag-shared')").run();
  assert.equal((await getBlogDataSummary()).usedTags, 1);

  insertSummaryPost(db, 'post-about-summary', 'about');
  db.prepare("INSERT INTO tags (id, name, slug, color, created_at, updated_at) VALUES ('tag-about', 'About', 'about-tag', NULL, ?, ?)").run(now, now);
  db.prepare("INSERT INTO post_tags (post_id, tag_id) VALUES ('post-about-summary', 'tag-about')").run();
  assert.equal((await getBlogDataSummary()).usedTags, 2);

  db.prepare("INSERT INTO tags (id, name, slug, color, created_at, updated_at) VALUES ('tag-unused-summary', 'Unused', 'unused-summary', NULL, ?, ?)").run(now, now);
  assert.equal((await getBlogDataSummary()).usedTags, 2);

  db.exec('PRAGMA ignore_check_constraints=ON');
  insertSummaryPost(db, 'post-draft-summary', 'draft-summary', 'draft');
  insertSummaryPost(db, 'post-archived-summary', 'archived-summary', 'archived');
  insertSummaryPost(db, 'post-private-summary', 'private-summary', 'published', 'private');
  db.exec('PRAGMA ignore_check_constraints=OFF');
  db.prepare("INSERT INTO tags (id, name, slug, color, created_at, updated_at) VALUES ('tag-hidden-summary', 'Hidden', 'hidden-summary', NULL, ?, ?)").run(now, now);

  for (const postId of ['post-draft-summary', 'post-archived-summary', 'post-private-summary']) {
    db.prepare('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)').run(postId, 'tag-hidden-summary');
  }

  const summary = await getBlogDataSummary();
  assert.equal(summary.usedTags, 2);
  assert.equal(summary.referencedMedia, 0);
  const exported = parseJsonExport(
    (await exportBlogData({ articles: true, media: false, friends: false }, 'https://source.example')).bytes
  );
  assert.equal(exported.manifest.counts.tags, summary.usedTags);
  assert.equal(exported.manifest.counts.media, summary.referencedMedia);
  assert.equal(exported.tags.length, summary.usedTags);
}

async function seedMediaExportRows(d1: SqliteD1Database, bucket: FakeR2Bucket, count: number): Promise<void> {
  const db = d1.db;
  const mediaSha = await sha256(pngBytes);

  for (let index = 0; index < count; index += 1) {
    const token = `E${String(index).padStart(23, '0')}`;
    const assetId = `asset-export-${index}`;
    const postId = `post-export-${index}`;
    const r2Key = `r2-export-${index}`;
    bucket.objects.set(r2Key, { bytes: pngBytes, contentType: 'image/png' });
    db.prepare(
      `INSERT INTO assets (
        id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
        visibility, usage_count, created_by, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, 'image/png', ?, NULL, NULL, ?, 'public', 1, 'env_admin', ?, ?, NULL)`
    ).run(assetId, token, r2Key, `export-${index}.png`, pngBytes.byteLength, mediaSha, now, now);
    db.prepare(
      `INSERT INTO posts (
        id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
        seo_title, seo_description, reading_time_minutes, word_count, published_at, pinned_at, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, NULL, NULL, 'published', 'public', NULL, NULL, 1, 1, ?, NULL, ?, ?)`
    ).run(postId, `export-${index}`, `Export ${index}`, `![export](asset:${token})`, now, now, now);
    db.prepare("INSERT INTO post_assets (post_id, asset_id, role, created_at) VALUES (?, ?, 'inline', ?)").run(postId, assetId, now);
  }
}

async function testExportImportMediaLimits(): Promise<void> {
  const okDb = createDb();
  const okBucket = new FakeR2Bucket();
  setTestEnv(okDb, okBucket);
  await seedMediaExportRows(okDb, okBucket, 120);
  const zipExport = await exportBlogData({ articles: true, media: true, friends: false }, 'https://source.example');
  assert.equal(zipExport.json, false);
  assert.equal(parseDataZip(bytesToArrayBuffer(zipExport.bytes)).filter((file) => file.path.startsWith('media/')).length, 120);
  assert.equal((await inspectWithCurrentEnv(zipFileFromBytes(zipExport.bytes))).ok, true);

  const tooManyDb = createDb();
  const tooManyBucket = new FakeR2Bucket();
  setTestEnv(tooManyDb, tooManyBucket);
  await seedMediaExportRows(tooManyDb, tooManyBucket, 121);
  await expectReject('121 media export rejects before creating an unrestorable backup', () =>
    exportBlogData({ articles: true, media: true, friends: false }, 'https://source.example')
  );

  const emptyDb = createDb();
  const emptyBucket = new FakeR2Bucket();
  setTestEnv(emptyDb, emptyBucket);
  const emptyZip = await exportBlogData({ articles: true, media: true, friends: false }, 'https://source.example');
  assert.equal(emptyZip.json, false);
  assert.equal((await inspectWithCurrentEnv(zipFileFromBytes(emptyZip.bytes))).ok, true);
}

async function testImportJsonWithoutMedia(jsonBytes: Uint8Array): Promise<void> {
  const missingTarget = createDb();
  const missingBucket = new FakeR2Bucket();
  setTestEnv(missingTarget, missingBucket);
  await expectReject('articles-only import preflight rejects missing target media', () => inspectWithCurrentEnv(jsonFileFromBytes(jsonBytes)));

  const target = createDb();
  const bucket = new FakeR2Bucket();
  setTestEnv(target, bucket);
  await seedTargetMedia(target, bucket);
  const file = jsonFileFromBytes(jsonBytes);
  const inspect = await inspectWithCurrentEnv(file);
  const result = await importBlogDataFile(file, sessionRequest, {
    importPlanToken: inspect.importPlanToken,
    sections: { articles: true, media: false, friends: false },
    articleConflictStrategy: 'skip',
    friendConflictStrategy: 'skip'
  });
  assert.equal(result.articles.created, 2);
  assert.equal(result.media.uploaded, 0);
  assert.equal(bucket.putKeys.length, 0);
  assert.equal(countRows(target.db, "SELECT COUNT(*) AS count FROM posts WHERE slug = 'about'"), 1);
  const post = target.db.prepare("SELECT id, content_markdown, content_html, cover_asset_id FROM posts WHERE slug = 'hello-world'").get() as {
    id: string;
    content_markdown: string;
    content_html: string;
    cover_asset_id: string;
  };
  assert.match(post.content_markdown, new RegExp(`asset:${inlineToken}`));
  assert.equal(post.cover_asset_id, 'target-cover');
  assert.match(post.content_html, /<img/);
  assert.equal(countRows(target.db, 'SELECT COUNT(*) AS count FROM post_assets WHERE post_id = ?', post.id), 2);
  assert.equal(countRows(target.db, 'SELECT COUNT(*) AS count FROM assets WHERE id = ?', 'target-inline'), 1);
}

async function testImportZipWithMedia(zipBytes: Uint8Array): Promise<void> {
  const target = createDb();
  const bucket = new FakeR2Bucket();
  setTestEnv(target, bucket);
  const file = zipFileFromBytes(zipBytes);
  const inspect = await inspectWithCurrentEnv(file);
  const result = await importBlogDataFile(file, sessionRequest, {
    importPlanToken: inspect.importPlanToken,
    sections: { articles: true, media: true, friends: true },
    articleConflictStrategy: 'skip',
    friendConflictStrategy: 'skip'
  });
  assert.equal(result.articles.created, 2);
  assert.equal(result.media.uploaded, 3);
  assert.equal(result.friends.created, 1);
  assert.equal(bucket.putKeys.length, 3);
  const post = target.db.prepare("SELECT content_markdown, cover_asset_id FROM posts WHERE slug = 'hello-world'").get() as { content_markdown: string; cover_asset_id: string };
  assert.match(post.content_markdown, /asset:/);
  assert.doesNotMatch(post.content_markdown, new RegExp(inlineToken));
  assert.ok(post.cover_asset_id);
  assert.equal(countRows(target.db, 'SELECT COUNT(*) AS count FROM post_assets'), 2);
}

async function testReuseAndConflicts(zipBytes: Uint8Array, inlineSha: string): Promise<void> {
  const target = createDb();
  const bucket = new FakeR2Bucket();
  setTestEnv(target, bucket);
  target.db.prepare(
    `INSERT INTO assets (
      id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
      visibility, usage_count, created_by, created_at, updated_at, deleted_at
    ) VALUES ('asset-reuse', ?, 'r2-reuse', 'reuse.png', 'image/png', ?, NULL, NULL, ?, 'public', 0, 'env_admin', ?, ?, NULL)`
  ).run('R'.repeat(24), pngBytes.byteLength, inlineSha, now, now);
  const file = zipFileFromBytes(zipBytes);
  const inspect = await inspectWithCurrentEnv(file);
  await importBlogDataFile(file, sessionRequest, {
    importPlanToken: inspect.importPlanToken,
    sections: { articles: true, media: true, friends: true },
    articleConflictStrategy: 'skip',
    friendConflictStrategy: 'skip'
  });
  assert.equal(bucket.putKeys.length, 1);
  await seedTargetMedia(target, bucket);
  assert.equal(countRows(target.db, 'SELECT COUNT(*) AS count FROM assets WHERE token IN (?, ?, ?)', inlineToken, coverToken, tempToken), 3);
  const zipData = JSON.parse(new TextDecoder().decode(parseDataZip(bytesToArrayBuffer(zipBytes)).find((entry) => entry.path === 'data.json')?.bytes ?? new Uint8Array()));
  assert.match(JSON.stringify(zipData), new RegExp(inlineToken));
  assert.match(JSON.stringify(zipData), new RegExp(coverToken));
  assert.match(JSON.stringify(zipData), new RegExp(tempToken));
  assert.equal((await findAssetsByTokens(target as unknown as D1Database, [inlineToken, coverToken, tempToken])).length, 3);
  assert.equal((await findAssetsByTokens(getDb(), [inlineToken, coverToken, tempToken])).length, 3);
  const secondFile = zipFileFromBytes(zipBytes);
  const secondInspect = await inspectWithCurrentEnv(secondFile);
  const skipped = await importBlogDataFile(secondFile, sessionRequest, {
    importPlanToken: secondInspect.importPlanToken,
    sections: { articles: true, media: false, friends: true },
    articleConflictStrategy: 'skip',
    friendConflictStrategy: 'skip'
  });
  assert.equal(skipped.articles.skipped, 2);
  assert.equal(countRows(target.db, 'SELECT COUNT(*) AS count FROM assets WHERE token IN (?, ?, ?)', inlineToken, coverToken, tempToken), 3);
  const overwriteFile = zipFileFromBytes(zipBytes);
  const overwriteInspect = await inspectWithCurrentEnv(overwriteFile);
  const overwritten = await importBlogDataFile(overwriteFile, sessionRequest, {
    importPlanToken: overwriteInspect.importPlanToken,
    sections: { articles: true, media: false, friends: false },
    articleConflictStrategy: 'overwrite',
    friendConflictStrategy: 'skip'
  });
  assert.equal(overwritten.articles.overwritten, 2);
  assert.equal(countRows(target.db, "SELECT COUNT(*) AS count FROM posts WHERE slug = 'about'"), 1);
  const copyFile = zipFileFromBytes(zipBytes);
  const copyInspect = await inspectWithCurrentEnv(copyFile);
  const copied = await importBlogDataFile(copyFile, sessionRequest, {
    importPlanToken: copyInspect.importPlanToken,
    sections: { articles: true, media: false, friends: false },
    articleConflictStrategy: 'copy',
    friendConflictStrategy: 'skip'
  });
  assert.equal(copied.articles.created, 1);
  assert.equal(copied.articles.skipped, 1);
  assert.equal(countRows(target.db, "SELECT COUNT(*) AS count FROM posts WHERE slug LIKE 'hello-world-imported%'"), 1);
  assert.equal(countRows(target.db, "SELECT COUNT(*) AS count FROM posts WHERE slug = 'about'"), 1);
}

async function testFailures(jsonBytes: Uint8Array, zipBytes: Uint8Array): Promise<void> {
  const target = createDb();
  const bucket = new FakeR2Bucket(true);
  setTestEnv(target, bucket);
  const zipFile = zipFileFromBytes(zipBytes);
  const inspect = await inspectWithCurrentEnv(zipFile);
  await expectReject('R2 upload failure rejects import', () => importBlogDataFile(zipFile, sessionRequest, {
    importPlanToken: inspect.importPlanToken,
    sections: { articles: true, media: true, friends: false },
    articleConflictStrategy: 'skip',
    friendConflictStrategy: 'skip'
  }));
  assert.equal(countRows(target.db, 'SELECT COUNT(*) AS count FROM posts'), 0);
  const changedFile = jsonFileFromBytes(new TextEncoder().encode(JSON.stringify({ ...parseJsonExport(jsonBytes), createdAt: '2026-02-01T00:00:00.000Z' })));
  await expectReject('changed file rejects old token', () => importBlogDataFile(changedFile, sessionRequest, {
    importPlanToken: inspect.importPlanToken,
    sections: { articles: true, media: false, friends: false },
    articleConflictStrategy: 'skip',
    friendConflictStrategy: 'skip'
  }));
}

async function testSvgImportAndServingRejected(): Promise<void> {
  const target = createDb();
  const bucket = new FakeR2Bucket();
  setTestEnv(target, bucket);
  const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const svgToken = 'S'.repeat(24);
  const unsignedData = {
    format: BLOG_DATA_FORMAT,
    version: BLOG_DATA_VERSION,
    createdAt: now,
    source: { generator: 'Sakura Cactus', origin: 'https://source.example' },
    selectedSections: { articles: true, media: true, friends: false },
    manifest: { counts: { articles: 1, tags: 0, articleTagRelations: 0, media: 1, friends: 0 } },
    articles: [
      {
        type: 'article',
        slug: 'svg-post',
        title: 'SVG',
        excerpt: null,
        markdown: `![svg](asset:${svgToken})`,
        publishedAt: now,
        updatedAt: now,
        seoTitle: null,
        seoDescription: null,
        coverMediaToken: null
      }
    ],
    aboutPage: null,
    tags: [],
    articleTagRelations: [],
    mediaManifest: [
      {
        token: svgToken,
        filename: 'bad.svg',
        mimeType: 'image/svg+xml',
        sizeBytes: svgBytes.byteLength,
        sha256: await sha256(svgBytes),
        archivePath: 'media/bad.svg',
        usedBy: ['svg-post'],
        coverFor: []
      }
    ]
  };
  const data = await finalizeFixtureData(unsignedData);
  const dataBytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
  const manifest = {
    format: BLOG_DATA_FORMAT,
    version: BLOG_DATA_VERSION,
    createdAt: now,
    selectedSections: data.selectedSections,
    counts: data.manifest.counts,
    files: [
      { path: 'data.json', sizeBytes: dataBytes.byteLength, sha256: await sha256(dataBytes) },
      { path: 'media/bad.svg', sizeBytes: svgBytes.byteLength, sha256: await sha256(svgBytes) }
    ],
    mediaTotalBytes: svgBytes.byteLength
  };
  const zipBytes = createDataZip([
    { path: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
    { path: 'data.json', bytes: dataBytes },
    { path: 'media/bad.svg', bytes: svgBytes }
  ]);
  const file = zipFileFromBytes(zipBytes, 'svg.zip');

  await expectReject('SVG import preflight rejects before writes', () => inspectWithCurrentEnv(file));
  await expectReject('SVG formal import rejects before writes', () => importBlogDataFile(file, sessionRequest, {
    importPlanToken: 'not-needed-for-svg-parse-failure',
    sections: { articles: true, media: true, friends: false },
    articleConflictStrategy: 'skip',
    friendConflictStrategy: 'skip'
  }));
  assert.equal(bucket.putKeys.length, 0);
  assert.equal(countRows(target.db, 'SELECT COUNT(*) AS count FROM posts'), 0);

  bucket.objects.set('legacy-svg', { bytes: svgBytes, contentType: 'image/svg+xml' });
  target.db
    .prepare(
      `INSERT INTO assets (
        id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
        visibility, usage_count, created_by, created_at, updated_at, deleted_at
      ) VALUES ('asset-svg', ?, 'legacy-svg', 'legacy.svg', 'image/svg+xml', ?, NULL, NULL, ?, 'public', 0, 'env_admin', ?, ?, NULL)`
    )
    .run(svgToken, svgBytes.byteLength, await sha256(svgBytes), now, now);
  const response = await getImageByToken({ params: { token: svgToken }, request: new Request('https://target.example/i/' + svgToken) } as any);
  assert.equal(response.status, 415);
  assert.notEqual(response.headers.get('Content-Type'), 'image/svg+xml');
  assert.notEqual(response.headers.get('Content-Disposition'), 'inline');
}

async function writeFixtures(jsonBytes: Uint8Array, zipBytes: Uint8Array): Promise<void> {
  mkdirSync(fixtureDir, { recursive: true });
  const valid = parseJsonExport(jsonBytes);
  const writeJson = async (name: string, value: unknown) => writeFileSync(path.join(fixtureDir, name), JSON.stringify(await finalizeFixtureData(value), null, 2));
  writeFileSync(path.join(fixtureDir, 'valid-articles-only.json'), jsonBytes);
  await writeJson('valid-articles-friends.json', {
    ...valid,
    selectedSections: { articles: true, media: false, friends: true },
    friends: [{ name: 'Fixture Friend', url: 'https://www.w3.org/', avatarUrl: null, description: null }],
    manifest: { counts: { ...valid.manifest.counts, friends: 1 } }
  });
  await writeJson('valid-friends-only.json', {
    ...valid,
    selectedSections: { articles: false, media: false, friends: true },
    articles: [],
    aboutPage: null,
    tags: [],
    articleTagRelations: [],
    friends: [{ name: 'Fixture Friend', url: 'https://www.w3.org/', avatarUrl: null, description: null }],
    mediaManifest: undefined,
    manifest: { counts: { articles: 0, tags: 0, articleTagRelations: 0, media: 0, friends: 1 } }
  });
  await writeJson('valid-unicode.json', { ...valid, articles: valid.articles.map((article: any) => ({ ...article, title: '樱花与仙人掌' })) });
  await writeJson('valid-conflicts.json', valid);
  writeFileSync(path.join(fixtureDir, 'valid-with-media.zip'), zipBytes);

  const invalidDraft = { ...valid, articles: [{ ...valid.articles[0], status: 'draft' }] };
  writeFileSync(path.join(fixtureDir, 'invalid-checksum.json'), JSON.stringify({ ...valid, createdAt: '2026-03-01T00:00:00.000Z' }, null, 2));
  await writeJson('invalid-version.json', { ...valid, version: 999 });
  await writeJson('invalid-secret-fields.json', { ...valid, secret: 'nope' });
  await writeJson('invalid-counts.json', { ...valid, manifest: { counts: { ...valid.manifest.counts, articles: 99 } } });
  await writeJson('invalid-types.json', { ...valid, articles: 'bad' });
  await writeJson('invalid-over-limit.json', { ...valid, articles: [{ ...valid.articles[0], markdown: 'x'.repeat(210_000) }] });
  await writeJson('invalid-unknown-section.json', { ...valid, selectedSections: { ...valid.selectedSections, settings: true } });
  await writeJson('invalid-draft-status.json', invalidDraft);
  await writeJson('invalid-archived-status.json', { ...valid, articles: [{ ...valid.articles[0], status: 'archived' }] });
  await writeJson('invalid-deleted-status.json', { ...valid, articles: [{ ...valid.articles[0], status: 'deleted' }] });
  await writeJson('invalid-unknown-status.json', { ...valid, articles: [{ ...valid.articles[0], status: 'hidden' }] });
  await writeJson('invalid-multiple-about.json', { ...valid, articles: [...valid.articles, { ...valid.aboutPage, type: 'article' }] });

  for (const name of [
    'invalid-media-checksum.zip',
    'invalid-zip-path.zip',
    'invalid-absolute-path.zip',
    'invalid-media-type.zip',
    'invalid-media-size.zip',
    'invalid-missing-media-file.zip',
    'invalid-extra-media-file.zip',
    'invalid-decompression-ratio.zip',
    'invalid-duplicate-file.zip'
  ]) {
    writeFileSync(path.join(fixtureDir, name), new Uint8Array([0x50, 0x4b, 0x00, 0x00]));
  }
}

async function verifyFixtures(): Promise<void> {
  const target = createDb();
  const bucket = new FakeR2Bucket();
  setTestEnv(target, bucket);
  await seedTargetMedia(target, bucket);
  const entries = [
    'valid-articles-only.json',
    'valid-articles-friends.json',
    'valid-friends-only.json',
    'valid-unicode.json',
    'valid-conflicts.json',
    'valid-with-media.zip',
    'invalid-checksum.json',
    'invalid-version.json',
    'invalid-secret-fields.json',
    'invalid-counts.json',
    'invalid-types.json',
    'invalid-over-limit.json',
    'invalid-unknown-section.json',
    'invalid-draft-status.json',
    'invalid-archived-status.json',
    'invalid-deleted-status.json',
    'invalid-unknown-status.json',
    'invalid-multiple-about.json',
    'invalid-zip-path.zip'
  ];

  for (const entry of entries) {
    const bytes = readFileSync(path.join(fixtureDir, entry));
    const file = entry.endsWith('.zip') ? zipFileFromBytes(bytes, entry) : jsonFileFromBytes(bytes, entry);

    if (entry.startsWith('valid-')) {
      await inspectWithCurrentEnv(file);
    } else {
      await expectReject(`${entry} should be rejected`, () => inspectWithCurrentEnv(file));
    }
  }
}

async function main(): Promise<void> {
  const { jsonBytes, zipBytes } = await testExportAndInspect();
  await testSummaryTagCounts();
  await testExportImportMediaLimits();
  const { inlineSha } = await seedSource();
  await testImportJsonWithoutMedia(jsonBytes);
  await testImportZipWithMedia(zipBytes);
  await testReuseAndConflicts(zipBytes, inlineSha);
  await testFailures(jsonBytes, zipBytes);
  await testSvgImportAndServingRejected();
  await writeFixtures(jsonBytes, zipBytes);
  await verifyFixtures();
  console.log('Blog data portability checks passed.');
}

await main();
