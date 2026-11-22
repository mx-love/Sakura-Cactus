import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { buildSubjectRows, selectVisibleTags, tagSeriesYears, type TagIndexEntry } from '../src/features/tags/tag-index.ts';
import { getPublicTagIndex } from '../src/features/tags/tag.service.ts';
import { listPublicArchivePosts } from '../src/features/posts/post.repo.ts';

type SqlValue = string | number | bigint | null | Uint8Array;

// Minimal D1 adapter over node:sqlite so the real aggregate SQL runs in tests.
class SqliteD1Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly query: string,
    private readonly values: SqlValue[] = []
  ) {}

  bind(...values: SqlValue[]) {
    return new SqliteD1Statement(this.db, this.query, values);
  }

  async first<T>() {
    return (this.db.prepare(this.query).get(...this.values) ?? null) as T | null;
  }

  async all<T>() {
    return { success: true, meta: {}, results: this.db.prepare(this.query).all(...this.values) as T[] };
  }
}

class SqliteD1Database {
  readonly queries: string[] = [];
  constructor(readonly db: DatabaseSync) {}
  prepare(query: string) {
    this.queries.push(query);
    return new SqliteD1Statement(this.db, query);
  }
}

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE posts (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, excerpt TEXT,
      status TEXT NOT NULL, visibility TEXT NOT NULL, published_at TEXT, pinned_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, slug TEXT NOT NULL UNIQUE, color TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE post_tags (post_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (post_id, tag_id));
  `);
  return db;
}

function addTag(db: DatabaseSync, id: string, name: string) {
  db.prepare("INSERT INTO tags (id, name, slug, color, created_at, updated_at) VALUES (?, ?, ?, NULL, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')").run(id, name, `slug-${id}`);
}

function addPost(db: DatabaseSync, id: string, publishedAt: string | null, tagIds: string[], options: { status?: string; visibility?: string; slug?: string; excerpt?: string } = {}) {
  db.prepare(
    'INSERT INTO posts (id, slug, title, excerpt, status, visibility, published_at, pinned_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)'
  ).run(id, options.slug ?? `post-${id}`, `Title ${id}`, options.excerpt ?? null, options.status ?? 'published', options.visibility ?? 'public', publishedAt, publishedAt ?? '2020-01-01T00:00:00.000Z', publishedAt ?? '2020-01-01T00:00:00.000Z');
  for (const tagId of tagIds) db.prepare('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)').run(id, tagId);
}

const NOW = '2026-11-22T04:00:00.000Z';
const entry = (name: string, postCount = 1): TagIndexEntry => ({ id: name, name, slug: name, postCount });

test('visible tags need a positive public post count and sort by count then name', () => {
  const visible = selectVisibleTags([
    { id: 'a', name: '随笔', slug: 'a', post_count: 3 },
    { id: 'b', name: '草稿', slug: 'b', post_count: 0 },
    { id: 'c', name: '读书', slug: 'c', post_count: 3 },
    { id: 'd', name: '经济', slug: 'd', post_count: 7 }
  ]);
  assert.deepEqual(visible.map((tag) => tag.id), ['d', 'c', 'a']);
});

test('yearly series run from the first public year to now, capped, with zero years kept', () => {
  assert.deepEqual(tagSeriesYears(2019, 2026), [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
  assert.deepEqual(tagSeriesYears(null, 2026), [2026]);
  assert.deepEqual(tagSeriesYears(2001, 2026, 4), [2023, 2024, 2025, 2026]);
  const [row] = buildSubjectRows([entry('t', 3)], [2024, 2025, 2026], [{ tag_id: 't', year: 2024, post_count: 1 }, { tag_id: 't', year: 2026, post_count: 2 }], []);
  assert.deepEqual(row.years, [{ year: 2024, count: 1 }, { year: 2025, count: 0 }, { year: 2026, count: 2 }]);
  assert.equal(row.latest, null);
});

test('/tags shows only tags with public published posts and counts only those', async () => {
  const db = createDb();
  addTag(db, 'public', '随笔');
  addTag(db, 'mixed', '读书');
  addTag(db, 'draft', '草稿主题');
  addTag(db, 'private', '私密主题');
  addTag(db, 'future', '未来主题');
  addTag(db, 'unpublished', '未发布');
  addTag(db, 'about', '关于');
  addTag(db, 'empty', '空标签');
  addPost(db, 'p1', '2024-03-01T00:00:00.000Z', ['public', 'mixed']);
  addPost(db, 'p2', '2026-02-01T00:00:00.000Z', ['public']);
  addPost(db, 'p3', '2026-03-01T00:00:00.000Z', ['mixed', 'draft'], { status: 'draft' });
  addPost(db, 'p4', '2025-01-01T00:00:00.000Z', ['private'], { visibility: 'private' });
  addPost(db, 'p5', '2027-01-01T00:00:00.000Z', ['future', 'public']);
  addPost(db, 'p6', null, ['unpublished']);
  addPost(db, 'p7', '2023-01-01T00:00:00.000Z', ['about'], { slug: 'about' });

  const d1 = new SqliteD1Database(db);
  const index = await getPublicTagIndex(d1 as unknown as D1Database, NOW);
  assert.equal(index.total, 2);
  assert.deepEqual(index.subjects.map((tag) => [tag.name, tag.postCount]), [['随笔', 2], ['读书', 1]]);
  assert.deepEqual(index.years, [2024, 2025, 2026]);
  assert.deepEqual(index.subjects[0].years.map((bar) => bar.count), [1, 0, 1]);
  assert.deepEqual(index.subjects.map((tag) => tag.latest?.slug), ['post-p2', 'post-p1']);
  // Four aggregate queries regardless of how many tags there are.
  assert.equal(d1.queries.length, 4);
});

test('large indexes list every visible tag in one table with bars and latest posts', async () => {
  const db = createDb();
  // More tags than D1's 100 bound parameters, so no query may bind a tag id list.
  const names = Array.from({ length: 120 }, (_, index) => (index % 3 === 0 ? `Tag ${index}` : `标签${index}`));
  names.forEach((name, index) => addTag(db, `t${index}`, name));
  addTag(db, 'hidden', '草稿');
  names.forEach((_, index) => {
    for (let count = 0; count <= index % 7; count += 1) {
      addPost(db, `p${index}-${count}`, `202${count % 7}-06-0${(count % 9) + 1}T00:00:00.000Z`, [`t${index}`]);
    }
  });
  addPost(db, 'draft', '2026-01-01T00:00:00.000Z', ['hidden'], { status: 'draft' });

  const d1 = new SqliteD1Database(db);
  const index = await getPublicTagIndex(d1 as unknown as D1Database, NOW);
  assert.equal(index.total, names.length);
  assert.equal(index.subjects.length, names.length);
  assert.ok(!index.subjects.some((tag) => tag.name === '草稿'));
  for (let i = 1; i < index.subjects.length; i += 1) {
    const [prev, next] = [index.subjects[i - 1], index.subjects[i]];
    assert.ok(prev.postCount > next.postCount || (prev.postCount === next.postCount && prev.name.localeCompare(next.name, 'zh-CN') <= 0));
  }
  for (const tag of index.subjects) {
    assert.equal(tag.years.reduce((sum, bar) => sum + bar.count, 0), tag.postCount);
    assert.ok(tag.latest, `${tag.name} has a latest post`);
  }
  assert.equal(d1.queries.length, 4);
  assert.ok(d1.queries.every((query) => !/\bIN \(/.test(query)), 'aggregate queries bind no tag id list');
});

test('archive rows carry the excerpt and the first tag by name', async () => {
  const db = createDb();
  addTag(db, 'b', '旅行');
  addTag(db, 'a', 'Astro');
  addPost(db, 'x', '2026-01-02T00:00:00.000Z', ['b', 'a'], { excerpt: '摘要' });
  addPost(db, 'y', '2026-01-01T00:00:00.000Z', []);
  const rows = await listPublicArchivePosts(new SqliteD1Database(db) as unknown as D1Database);
  assert.deepEqual(rows.map((row) => [row.slug, row.excerpt, row.tag_name, row.tag_slug]), [
    ['post-x', '摘要', 'Astro', 'slug-a'],
    ['post-y', null, null, null]
  ]);
});
