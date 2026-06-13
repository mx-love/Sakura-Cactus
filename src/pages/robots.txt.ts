import type { APIRoute } from 'astro';
import { absoluteSiteUrl } from '@/lib/seo';

export const prerender = false;

export const GET: APIRoute = async () => {
  const sitemapUrl = absoluteSiteUrl('/sitemap.xml');
  const text = `User-agent: *
Allow: /
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
