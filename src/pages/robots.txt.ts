import type { APIRoute } from 'astro';

export const prerender = false;

const SITE_ORIGIN = 'https://fymi.link';

export const GET: APIRoute = async () => {
  const sitemapUrl = new URL('/sitemap.xml', SITE_ORIGIN).toString();
  const text = `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /write
Disallow: /settings
Disallow: /api/
Disallow: /i/

Sitemap: ${sitemapUrl}
`;

  return new Response(text, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8'
    }
  });
};
