import { env } from 'cloudflare:workers';

const DEFAULT_SITE_URL = 'https://fymi.link';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export const ROBOTS_INDEX_FOLLOW = 'index,follow';
export const ROBOTS_NOINDEX_FOLLOW = 'noindex,follow';
export const ROBOTS_NOINDEX_NOFOLLOW = 'noindex,nofollow';

function normalizeSiteOrigin(value: string | undefined): string {
  const candidate = value?.trim() || DEFAULT_SITE_URL;

  try {
    const url = new URL(candidate);

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.origin;
    }
  } catch {
    return DEFAULT_SITE_URL;
  }

  return DEFAULT_SITE_URL;
}

export function getSiteOrigin(): string {
  return normalizeSiteOrigin(env.SITE_URL);
}

export function absoluteSiteUrl(path: string): string {
  return new URL(path, getSiteOrigin()).toString();
}

export function getCanonicalRedirectUrl(url: URL): string | null {
  const siteOrigin = getSiteOrigin();
  const targetOrigin = new URL(siteOrigin);

  if (LOCAL_HOSTS.has(url.hostname) || url.origin === targetOrigin.origin) {
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
