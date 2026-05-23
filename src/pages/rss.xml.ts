import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getPublicPosts } from '@/features/posts/post.service';

export const prerender = false;

const SITE_TITLE = 'Sakura Cactus';
const SITE_DESCRIPTION = '温柔地写，安静地发布。';
const SITE_LANGUAGE = 'zh-CN';
const LOCAL_SITE_URL = 'http://localhost:4321';

function getSiteUrl(): string {
  const runtimeEnv = env as unknown as { SITE_URL?: string; PUBLIC_SITE_URL?: string };
  const configured = runtimeEnv.SITE_URL || runtimeEnv.PUBLIC_SITE_URL || LOCAL_SITE_URL;
  return configured.replace(/\/+$/, '');
}

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

function toRssDate(value: string | null | undefined): string {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toUTCString() : date.toUTCString();
}

export const GET: APIRoute = async () => {
  const siteUrl = getSiteUrl();
  const posts = await getPublicPosts();

  const items = posts
    .map((post) => {
      const postUrl = absoluteUrl(`/posts/${post.slug}`, siteUrl);
      const excerpt = post.excerpt ?? '';

      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(postUrl)}</link>
      <guid isPermaLink="true">${escapeXml(postUrl)}</guid>
      <pubDate>${escapeXml(toRssDate(post.publishedAt))}</pubDate>
      <description>${escapeXml(excerpt)}</description>
      <content:encoded>${escapeXml(excerpt)}</content:encoded>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(SITE_TITLE)}</title>
    <description>${escapeXml(SITE_DESCRIPTION)}</description>
    <link>${escapeXml(siteUrl)}</link>
    <language>${escapeXml(SITE_LANGUAGE)}</language>
    <ttl>60</ttl>
    <lastBuildDate>${escapeXml(new Date().toUTCString())}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8'
    }
  });
};
