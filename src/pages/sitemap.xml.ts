import type { APIRoute } from 'astro';
import { getPublicSitemapPosts } from '@/features/posts/post.service';
import { getPublicTags } from '@/features/tags/tag.service';

export const prerender = false;

function absoluteUrl(path: string, siteUrl: string): string {
  return new URL(path, siteUrl).toString();
}

function escapeXml(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toLastMod(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function sitemapUrl(path: string, siteUrl: string, options: { lastmod?: string; changefreq?: string; priority?: string } = {}): string {
  const lastmod = options.lastmod ? `\n    <lastmod>${escapeXml(options.lastmod)}</lastmod>` : '';
  const changefreq = options.changefreq ? `\n    <changefreq>${escapeXml(options.changefreq)}</changefreq>` : '';
  const priority = options.priority ? `\n    <priority>${escapeXml(options.priority)}</priority>` : '';

  return `  <url>
    <loc>${escapeXml(absoluteUrl(path, siteUrl))}</loc>${lastmod}${changefreq}${priority}
  </url>`;
}

export const GET: APIRoute = async ({ request }) => {
  const siteUrl = new URL(request.url).origin;
  const now = new Date().toISOString();
  const posts = await getPublicSitemapPosts();
  const tags = (await getPublicTags()).filter((tag) => tag.post_count > 0);

  const staticUrls = [
    sitemapUrl('/', siteUrl, { lastmod: now, changefreq: 'weekly', priority: '1.0' }),
    sitemapUrl('/articles', siteUrl, { lastmod: now, changefreq: 'daily', priority: '0.9' }),
    sitemapUrl('/timeline', siteUrl, { lastmod: now, changefreq: 'weekly', priority: '0.7' }),
    sitemapUrl('/tags', siteUrl, { lastmod: now, changefreq: 'weekly', priority: '0.7' }),
    sitemapUrl('/friends', siteUrl, { lastmod: now, changefreq: 'monthly', priority: '0.5' }),
    sitemapUrl('/about', siteUrl, { lastmod: now, changefreq: 'monthly', priority: '0.6' }),
    sitemapUrl('/search', siteUrl, { lastmod: now, changefreq: 'monthly', priority: '0.4' })
  ];

  const postUrls = posts.map((post) =>
    sitemapUrl(`/posts/${post.slug}`, siteUrl, {
      lastmod: toLastMod(post.updated_at || post.published_at),
      changefreq: 'monthly',
      priority: '0.8'
    })
  );

  const tagUrls = tags.map((tag) =>
    sitemapUrl(`/tags/${tag.slug}`, siteUrl, {
      changefreq: 'weekly',
      priority: '0.6'
    })
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticUrls, ...postUrls, ...tagUrls].join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8'
    }
  });
};
