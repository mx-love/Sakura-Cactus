import type { APIRoute } from 'astro';
import { getPublicSitemapPosts } from '@/features/posts/post.service';
import { absoluteSiteUrl } from '@/lib/seo';

export const prerender = false;

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

function sitemapUrl(path: string, options: { lastmod?: string; changefreq?: string; priority?: string } = {}): string {
  const lastmod = options.lastmod ? `\n    <lastmod>${escapeXml(options.lastmod)}</lastmod>` : '';
  const changefreq = options.changefreq ? `\n    <changefreq>${escapeXml(options.changefreq)}</changefreq>` : '';
  const priority = options.priority ? `\n    <priority>${escapeXml(options.priority)}</priority>` : '';

  return `  <url>
    <loc>${escapeXml(absoluteSiteUrl(path))}</loc>${lastmod}${changefreq}${priority}
  </url>`;
}

export const GET: APIRoute = async () => {
  const posts = await getPublicSitemapPosts();

  const staticUrls = [
    sitemapUrl('/', { changefreq: 'weekly', priority: '1.0' }),
    sitemapUrl('/articles', { changefreq: 'daily', priority: '0.9' }),
    sitemapUrl('/about', { changefreq: 'monthly', priority: '0.6' })
  ];

  const postUrls = posts.map((post) =>
    sitemapUrl(`/posts/${post.slug}`, {
      lastmod: toLastMod(post.updated_at || post.published_at),
      changefreq: 'monthly',
      priority: '0.8'
    })
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticUrls, ...postUrls].join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8'
    }
  });
};
