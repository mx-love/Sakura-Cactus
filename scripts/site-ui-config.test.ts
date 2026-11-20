import assert from 'node:assert/strict';
import { test } from 'node:test';
import { optionalPublicHttpsUrl } from '../src/lib/site-public-urls.ts';
import { listMonthlyPublicPostDates } from '../src/features/posts/post.repo.ts';

test('optional social/share URLs retain the public HTTPS security boundary', () => {
  for (const value of [undefined, '', 'http://github.com/user', 'javascript:alert(1)', 'https://127.0.0.1/i', 'https://localhost/i', 'https://user:pass@github.com/name']) {
    assert.equal(optionalPublicHttpsUrl(value), undefined, String(value));
  }
  assert.equal(optionalPublicHttpsUrl(' https://github.com/name '), 'https://github.com/name');
});

test('calendar date query is bounded to due public articles and never reads bodies', async () => {
  const range = { monthStart: '2026-10-31T16:00:00.000Z', nextMonthStart: '2026-11-30T16:00:00.000Z', currentTime: '2026-11-18T00:00:00.000Z' };
  const db = { prepare(query: string) {
    assert.ok(query.startsWith('SELECT published_at FROM posts'));
    assert.ok(!query.includes('content_'));
    assert.ok(query.includes("slug != 'about'"));
    assert.ok(query.includes("status = 'published' AND visibility = 'public'"));
    assert.ok(query.includes('published_at >= ? AND published_at < ?'));
    return { bind(...values: string[]) {
      assert.deepEqual(values, [range.currentTime, range.monthStart, range.nextMonthStart]);
      return { all: async () => ({ results: [{ published_at: '2026-11-17T23:30:00Z' }] }) };
    } };
  } } as unknown as D1Database;
  assert.deepEqual(await listMonthlyPublicPostDates(db, range), ['2026-11-17T23:30:00Z']);
});
