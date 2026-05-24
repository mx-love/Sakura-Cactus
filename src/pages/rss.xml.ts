import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getPublicFeedPosts } from '@/features/posts/post.service';
import { decodeHtmlEntities } from '@/features/posts/post.renderer';

export const prerender = false;

const SITE_LANGUAGE = 'zh-CN';

function readSiteIdentity() {
  return {
    name: env.SITE_NAME?.trim() || 'Sakura Cactus',
    description: env.SITE_DESCRIPTION?.trim() || '一些文章、笔记，以及慢慢整理的想法。'
  };
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

export const GET: APIRoute = async ({ request }) => {
  const siteUrl = new URL(request.url).origin;
  const siteIdentity = readSiteIdentity();
  const posts = await getPublicFeedPosts(50);

  const items = posts
    .map((post) => {
      const postUrl = absoluteUrl(`/posts/${post.slug}`, siteUrl);
      const excerpt = post.excerpt ? decodeHtmlEntities(post.excerpt) : '';

      return `    <item>
      <title>${escapeXml(decodeHtmlEntities(post.title))}</title>
      <link>${escapeXml(postUrl)}</link>
      <guid isPermaLink="true">${escapeXml(postUrl)}</guid>
      <pubDate>${escapeXml(toRssDate(post.published_at))}</pubDate>
      <description>${escapeXml(excerpt)}</description>
      <content:encoded>${escapeXml(excerpt)}</content:encoded>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(siteIdentity.name)}</title>
    <description>${escapeXml(siteIdentity.description)}</description>
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
