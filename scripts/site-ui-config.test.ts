import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { optionalPublicHttpsUrl } from '../src/lib/site-public-urls.ts';
import { listMonthlyPublicPostDates } from '../src/features/posts/post.repo.ts';

test('editorial pagination preserves navigation semantics and full-length page numbers', () => {
  const template = readFileSync(new URL('../src/pages/articles.astro', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../src/styles/public-pages.css', import.meta.url), 'utf8');
  assert.match(template, /currentPage > 1/);
  assert.match(template, /currentPage < totalPages/);
  assert.match(template, /href=\{`\/articles\?page=\$\{currentPage - 1\}`\} rel="prev"/);
  assert.match(template, /href=\{`\/articles\?page=\$\{currentPage \+ 1\}`\} rel="next"/);
  for (const value of ['currentPage', 'totalPages']) {
    assert.ok(template.includes(`String(${value}).padStart(2, '0')`));
  }
  assert.match(template, /class="sr-only">第 \{currentPage\} 页，共 \{totalPages\} 页/);
  assert.match(template, /class="sc-pagination-numbers" aria-hidden="true"/);
  assert.equal(template.match(/sc-pagination-disabled" aria-disabled="true"/g)?.length, 2);
  assert.match(styles, /grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
  assert.match(styles, /font-variant-numeric:\s*lining-nums tabular-nums/);
});

test('footer keeps three icon links with safe platform defaults and optional profile overrides', () => {
  const template = readFileSync(new URL('../src/components/layout/SiteLayout.astro', import.meta.url), 'utf8');
  assert.match(template, /<nav class="sc-footer-links sc-footer-social" aria-label="外部链接">/);
  assert.ok(template.includes("optionalPublicHttpsUrl(env.SITE_GITHUB_URL) ?? 'https://github.com/'"));
  assert.ok(template.includes("optionalPublicHttpsUrl(env.SITE_BILIBILI_URL) ?? 'https://www.bilibili.com/'"));
  assert.match(template, /href=\{link.href\} target="_blank" rel="noopener noreferrer"/);
  for (const icon of ['cf', 'github', 'bilibili']) assert.ok(template.includes(`icon: '${icon}'`));
  const footer = template.slice(template.indexOf('<footer class="sc-site-footer">'), template.indexOf('</footer>'));
  assert.doesNotMatch(footer, /sc-footer-credit|href="\/rss.xml"|<span>Cloudflare<\/span>/);
});

test('footer edge groups share mirrored slots while the theme switcher stays on its center track', () => {
  const styles = readFileSync(new URL('../src/styles/layout.css', import.meta.url), 'utf8');
  assert.match(styles, /\.sc-footer-meta-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
  assert.match(styles, /\.sc-footer-copyright,\s*\.sc-footer-social\s*\{\s*width:\s*min\(100%, var\(--sc-footer-edge-width\)\)/);
  assert.match(styles, /\.sc-footer-copyright\s*\{[^}]*text-align:\s*center/);
  assert.match(styles, /\.sc-footer-links\s*\{[^}]*justify-content:\s*center/);
});

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
