import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const siteOrigin = new URL(request.url).origin;
  const sitemapUrl = new URL('/sitemap.xml', siteOrigin).toString();
  const text = `User-agent: *
Allow: /

Sitemap: ${sitemapUrl}
`;

  return new Response(text, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8'
    }
  });
};
