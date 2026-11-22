import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { optionalPublicHttpsUrl } from '../src/lib/site-public-urls.ts';
import { listMonthlyPublicPostDates } from '../src/features/posts/post.repo.ts';

test('list pagination keeps prev/next semantics and accessible page position without visible page numbers', () => {
  const articles = readFileSync(new URL('../src/pages/articles.astro', import.meta.url), 'utf8');
  const pagination = readFileSync(new URL('../src/components/editorial/Pagination.astro', import.meta.url), 'utf8');
  const nav = readFileSync(new URL('../src/components/editorial/EntryNav.astro', import.meta.url), 'utf8');
  const header = readFileSync(new URL('../src/components/layout/SiteHeader.astro', import.meta.url), 'utf8');
  assert.match(articles, /<Pagination currentPage=\{currentPage\} totalPages=\{totalPages\} basePath="\/articles" newer=\{newer\} older=\{older\} \/>/);
  assert.match(articles, /folio=\{\{ current: Math\.min\(currentPage, totalPages\), total: totalPages \}\}/);
  assert.match(nav, /href=\{newer\.href\} rel="prev"/);
  assert.match(nav, /href=\{older\.href\} rel="next"/);
  assert.match(nav, /<nav class:list=\{\['sc-entry-nav'/);
  assert.match(nav, /aria-hidden="true"><\/span>/, 'a missing side is an empty, hidden cell');
  assert.match(pagination, /class="sr-only">第 \{currentPage\} 页，共 \{totalPages\} 页/);
  assert.match(pagination, /ariaLabel: `\$\{labelText\}：第 \$\{item\.page\} 页，共 \$\{totalPages\} 页/);
  assert.doesNotMatch(pagination, /href="\/timeline"/, 'the year index lives in the nav, not under every list page');
  assert.doesNotMatch(pagination, /◆/, 'no ornamental end mark on list pages');
  assert.match(header, /`Page \$\{pad\(folio\.current\)\} \/ \$\{pad\(folio\.total\)\}`/);
  assert.match(header, /const pad = \(value: number\) => String\(value\)\.padStart\(2, '0'\)/);
});

test('hero count keeps oldstyle figures, an accessible label and a thousands separator', () => {
  const hero = readFileSync(new URL('../src/components/editorial/PageHero.astro', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../src/styles/editorial.css', import.meta.url), 'utf8');
  assert.match(hero, /new Intl\.NumberFormat\('en-US'\)/);
  assert.match(hero, /<span class="sr-only">共 \{formattedCount\} \{countLabel\}<\/span>/);
  assert.match(hero, /class="sc-hero-count-figure" aria-hidden="true"/);
  const count = styles.match(/\.sc-hero-count\s*\{([^}]+)\}/)?.[1];
  assert.ok(count);
  assert.match(count, /font-family:\s*var\(--font-display\)/);
  assert.doesNotMatch(styles, /\.sc-hero-count[^{]*\{[^}]*lining-nums/);
  assert.match(styles, /\.sc-hero-count\[data-digits="3"\]/);
  assert.match(styles, /\.sc-hero-count\[data-digits="4"\]/);
});

test('adjacent list pages are labelled with a single bounded public row lookup', async () => {
  const { findPublicPostHeadlineAt } = await import('../src/features/posts/post.repo.ts');
  const db = { prepare(query: string) {
    assert.ok(query.startsWith('SELECT posts.slug, posts.title, posts.published_at'));
    assert.ok(!query.includes('content_'));
    assert.ok(query.includes("posts.status = 'published'"));
    assert.ok(query.includes("posts.visibility = 'public'"));
    assert.ok(query.includes('filter_tags.slug = ?'));
    assert.match(query, /LIMIT 1 OFFSET \?$/);
    return { bind(...values: unknown[]) {
      assert.equal(values.at(-1), 40);
      assert.equal(values.at(-2), 'notes');
      return { first: async () => ({ slug: 'p41', title: 'First of page 5', published_at: null }) };
    } };
  } } as unknown as D1Database;
  assert.deepEqual(await findPublicPostHeadlineAt(db, { excludeAbout: true, pinnedFirst: true, tagSlug: 'notes' }, 40), { slug: 'p41', title: 'First of page 5', published_at: null });
  assert.equal(await findPublicPostHeadlineAt(db, {}, -1), null);
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
