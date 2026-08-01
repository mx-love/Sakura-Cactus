import { env } from 'cloudflare:workers';
import { resolveSiteOrigin } from './site-url';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export const ROBOTS_INDEX_FOLLOW = 'index,follow';
export const ROBOTS_NOINDEX_FOLLOW = 'noindex,follow';
export const ROBOTS_NOINDEX_NOFOLLOW = 'noindex,nofollow';

export function getSiteOrigin(): string {
  return resolveSiteOrigin(env.SITE_URL, import.meta.env.DEV);
}

export function absoluteSiteUrl(path: string): string {
  return new URL(path, getSiteOrigin()).toString();
}

export function getCanonicalRedirectUrl(url: URL): string | null {
  if (LOCAL_HOSTS.has(url.hostname)) {
    return null;
  }

  const siteOrigin = getSiteOrigin();
  const targetOrigin = new URL(siteOrigin);

  if (url.origin === targetOrigin.origin) {
    return null;
  }

  return new URL(`${url.pathname}${url.search}`, siteOrigin).toString();
}

export function createJsonLd(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

export function summarizeHtml(html: string, fallback: string, maxLength = 160): string {
  const text = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return (text || fallback).slice(0, maxLength);
}
