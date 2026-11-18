import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPublicCacheContext, getPublicCacheKeys, purgePublicCache } from '../src/lib/cache.ts';
import { env } from 'cloudflare:workers';
import { getPublicCacheMetadata } from '../src/features/posts/post-cache.repo.ts';
import { capturePublicCacheState, invalidatePublicCache } from '../src/lib/public-cache-invalidation.ts';
import type { APIContext } from 'astro';

const origin = 'https://blog.example.com';
const urls = (scope: Parameters<typeof getPublicCacheKeys>[1]) => getPublicCacheKeys(`${origin}/ignored/`, scope).map((key) => key.url);

test('cache keys share read normalization, pagination and old/new slug handling', () => {
  const keys = urls({ postSlugs: ['new', 'about', 'new/'], oldPostSlugs: ['old/'], tagSlugs: ['notes/', 'notes'], articlePageCount: 3 });
  for (const path of ['/', '/articles', '/articles?page=2', '/articles?page=3', '/posts/new', '/posts/old', '/about', '/tags/notes', '/api/search-index']) {
    assert.ok(keys.includes(`${origin}${path}`), path);
  }
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) {
    const request = new Request(key);
    assert.equal(getPublicCacheContext(request, new URL(key))?.cacheKey.url, key);
  }
  const trailing = new URL(`${origin}/articles/?page=2&ignored=value`);
  assert.equal(getPublicCacheContext(new Request(trailing), trailing)?.cacheKey.url, `${origin}/articles?page=2`);
  assert.equal(urls({ articlePageCount: 999 }).filter((url) => url.includes('/articles')).length, 100);
  assert.equal(urls({ articlePageCount: 0 }).filter((url) => url.includes('/articles')).length, 1);
});

test('friend-only invalidation stays narrow and settings include every fixed route', () => {
  assert.deepEqual(urls({ friends: true }), [`${origin}/friends`]);
  const keys = urls({ settings: true, postSlugs: ['one'], tagSlugs: ['tag'] });
  for (const path of ['/robots.txt', '/about', '/friends', '/posts/one', '/tags/tag', '/sitemap.xml', '/rss.xml']) assert.ok(keys.includes(`${origin}${path}`));
});

test('a failed deletion does not stop other keys or escape to the mutation', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const originalWarn = console.warn;
  const deleted: string[] = [];
  let warnings = 0;
  console.warn = () => { warnings += 1; };
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { default: {
    delete: async (key: Request) => {
      deleted.push(key.url);
      if (key.url.endsWith('/articles')) throw new Error('Cache unavailable');
      return true;
    }
  } } });
  try {
    await purgePublicCache(origin, { postSlugs: ['old'], articlePageCount: 2 });
    assert.ok(deleted.includes(`${origin}/posts/old`));
    assert.ok(deleted.includes(`${origin}/articles?page=2`));
    assert.equal(warnings, 1);
  } finally {
    console.warn = originalWarn;
    if (previous) Object.defineProperty(globalThis, 'caches', previous);
    else Reflect.deleteProperty(globalThis, 'caches');
  }
});

test('mutation snapshots retain deleted slugs, old tags and the deleted final page; waitUntil is used', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const originalEnv = { ...env };
  const deleted: string[] = [];
  let rows = Array.from({ length: 6 }, (_, index) => ({
    slug: `post-${index}`, status: 'published', visibility: 'public', published_at: '2026-01-01T00:00:00Z'
  }));
  let tags = [{ slug: 'old-tag' }];
  const db = {
    prepare(query: string) {
      assert.ok(!query.includes('content_'), 'Never load article bodies for cache routing metadata.');
      return { all: async () => ({ results: query.includes('FROM posts') ? rows : tags }) };
    }
  } as unknown as D1Database;
  Object.assign(env, { DB: db, SITE_URL: origin });
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { default: {
    delete: async (key: Request) => { deleted.push(key.url); return true; }
  } } });
  try {
    assert.equal((await getPublicCacheMetadata(db, '2026-11-18T00:00:00Z')).articlePageCount, 2);
    const before = await capturePublicCacheState();
    rows = rows.slice(0, 5);
    tags = [{ slug: 'new-tag' }];
    const tasks: Promise<unknown>[] = [];
    const context = {
      url: new URL('https://preview.example.com/api/admin/posts/post-5'),
      locals: { cfContext: { waitUntil: (task: Promise<unknown>) => tasks.push(task) } }
    } as unknown as Pick<APIContext, 'url' | 'locals'>;
    await invalidatePublicCache(context, { postSlugs: ['new-slug'], oldPostSlugs: ['old-slug'] }, before);
    assert.equal(tasks.length, 1);
    await Promise.all(tasks);
    for (const host of [origin, 'https://preview.example.com']) {
      for (const path of ['/posts/post-5', '/posts/old-slug', '/posts/new-slug', '/articles?page=2', '/tags/old-tag', '/tags/new-tag']) {
        assert.ok(deleted.includes(`${host}${path}`), `${host}${path}`);
      }
    }
  } finally {
    for (const name of Object.keys(env)) Reflect.deleteProperty(env, name);
    Object.assign(env, originalEnv);
    if (previous) Object.defineProperty(globalThis, 'caches', previous);
    else Reflect.deleteProperty(globalThis, 'caches');
  }
});
