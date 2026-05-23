import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

const LOCAL_SITE_URL = 'http://localhost:4321';

function getSiteUrl(): string {
  const runtimeEnv = env as unknown as { SITE_URL?: string; PUBLIC_SITE_URL?: string };
  const configured = runtimeEnv.SITE_URL || runtimeEnv.PUBLIC_SITE_URL || LOCAL_SITE_URL;
  return configured.replace(/\/+$/, '');
}

export const GET: APIRoute = async () => {
  const sitemapUrl = new URL('/sitemap.xml', getSiteUrl()).toString();
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
