import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createSearchController, createSearchIndexLoader, normalizeSearchPost } from '../src/lib/site-search.ts';
import type { SearchPost, SearchState } from '../src/lib/site-search.ts';
import { listPublicSearchPosts } from '../src/features/posts/post.repo.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function post(title: string, slug = title): SearchPost {
  const normalized = normalizeSearchPost({ title, slug, excerpt: '', tags: [] });
  assert.ok(normalized);
  return normalized;
}

test('search normalizes public metadata, date terms and malformed optional values', () => {
  const normalized = normalizeSearchPost({
    title: 'Cloudflare 部署', slug: 'deploy', excerpt: '中文教程',
    tags: ['笔记', 12, null], published_at: '2026-07-25T12:00:00.000Z'
  });
  assert.ok(normalized);
  assert.deepEqual(normalized.tags, ['笔记']);
  assert.ok(normalized.searchableText.includes('cloudflare'));
  assert.ok(normalized.searchableText.includes('中文教程'));
  assert.ok(normalized.searchableText.includes('2026/07/25'));
  assert.ok(normalized.searchableText.includes('2026年7月25日'));
  assert.equal(normalizeSearchPost({ title: 'Missing slug' }), null);
  assert.equal(normalizeSearchPost(null), null);
  assert.equal(normalizeSearchPost({ title: 'Valid', slug: 'valid', published_at: 'invalid' })?.publishedAt, null);
});

test('concurrent index users share one request and a cached empty index is retained', async () => {
  const pending = deferred<Response>();
  let requests = 0;
  const loader = createSearchIndexLoader(async () => {
    requests += 1;
    return pending.promise;
  });
  const first = loader();
  const second = loader();
  assert.equal(requests, 1);
  pending.resolve(Response.json({ ok: true, data: { posts: [] } }));
  assert.deepEqual(await first, []);
  assert.strictEqual(await first, await second);
  assert.deepEqual(await loader(), []);
  assert.equal(requests, 1);
});

test('a failed or malformed index request can be retried successfully', async () => {
  let requests = 0;
  const loader = createSearchIndexLoader(async () => {
    requests += 1;
    if (requests === 1) return new Response('Unavailable', { status: 503 });
    if (requests === 2) return Response.json({ data: { posts: 'invalid' } });
    return Response.json({ data: { posts: [{ title: 'Recovered', slug: 'recovered' }] } });
  });
  await assert.rejects(loader(), /Search index request failed/);
  await assert.rejects(loader(), /Invalid search index/);
  assert.equal((await loader())[0].title, 'Recovered');
  assert.equal(requests, 3);
});

test('only the latest query renders when the first index request is slow', async () => {
  const index = deferred<SearchPost[]>();
  const states: SearchState[] = [];
  const controller = createSearchController(() => index.promise, (state) => states.push(state));
  const oldSearch = controller.search('部署');
  const currentSearch = controller.search('音乐');
  index.resolve([post('部署教程'), post('音乐配置')]);
  await Promise.all([oldSearch, currentSearch]);
  const completed = states.filter((state) => state.status === 'success');
  assert.equal(completed.length, 1);
  assert.equal(completed[0].query, '音乐');
  assert.deepEqual(completed[0].posts.map((item) => item.title), ['音乐配置']);
});

test('closing search invalidates pending results and errors', async () => {
  for (const failure of [false, true]) {
    const index = deferred<SearchPost[]>();
    const states: SearchState[] = [];
    const controller = createSearchController(() => index.promise, (state) => states.push(state));
    const search = controller.search('教程');
    controller.reset();
    if (failure) index.reject(new Error('Network error'));
    else index.resolve([post('教程')]);
    await search;
    assert.equal(states.at(-1)?.status, 'idle');
    assert.equal(states.some((state) => state.status === 'success' || state.status === 'error'), false);
  }
});

test('clearing the input prevents a previous query from returning', async () => {
  const index = deferred<SearchPost[]>();
  const states: SearchState[] = [];
  const controller = createSearchController(() => index.promise, (state) => states.push(state));
  const pending = controller.search('old');
  await controller.search('   ');
  index.resolve([post('old')]);
  await pending;
  assert.deepEqual(states.at(-1), { query: '', status: 'idle', posts: [] });
});

test('search can recover after an error without reloading the page', async () => {
  const states: SearchState[] = [];
  let requests = 0;
  const controller = createSearchController(async () => {
    requests += 1;
    if (requests === 1) throw new Error('Offline');
    return [post('纸页')];
  }, (state) => states.push(state));
  await controller.search('纸页');
  assert.equal(states.at(-1)?.status, 'error');
  await controller.search('纸页');
  assert.equal(states.at(-1)?.status, 'success');
  assert.equal(states.at(-1)?.posts.length, 1);
});

test('the public index includes older posts beyond 100 while excluding non-public content', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(`CREATE TABLE posts (
      id TEXT PRIMARY KEY, slug TEXT, title TEXT, excerpt TEXT,
      published_at TEXT, updated_at TEXT, status TEXT, visibility TEXT
    )`);
    const insert = sqlite.prepare('INSERT INTO posts VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (let index = 0; index < 140; index += 1) {
      insert.run(String(index), `post-${index}`, `Post ${index}`, '', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', 'published', 'public');
    }
    insert.run('private', 'private', 'Private', '', '2020-01-01T00:00:00.000Z', '', 'published', 'private');
    insert.run('draft', 'draft', 'Draft', '', '2020-01-01T00:00:00.000Z', '', 'draft', 'public');
    insert.run('future', 'future', 'Future', '', '2999-01-01T00:00:00.000Z', '', 'published', 'public');
    insert.run('undated', 'undated', 'Undated', '', null, '', 'published', 'public');
    insert.run('about', 'about', 'About', '', '2020-01-01T00:00:00.000Z', '', 'published', 'public');

    const db = {
      prepare(query: string) {
        return {
          bind(...values: Array<string | number | null>) {
            return {
              async all<T>() {
                return { success: true, meta: {}, results: sqlite.prepare(query).all(...values) as T[] };
              }
            };
          }
        };
      }
    } as unknown as D1Database;
    const rows = await listPublicSearchPosts(db);
    assert.equal(rows.length, 140);
    assert.equal(rows.some((row) => ['private', 'draft', 'future', 'undated', 'about'].includes(row.id)), false);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['excerpt', 'id', 'published_at', 'slug', 'title']);
    assert.equal((await listPublicSearchPosts(db, 5)).length, 5);
    assert.equal((await listPublicSearchPosts(db, 500)).length, 100);
  } finally {
    sqlite.close();
  }
});
