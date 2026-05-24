import { SESSION_COOKIE_NAME } from '@/features/auth/auth.constants';

const PUBLIC_CACHE_TTLS: Array<{ test: (pathname: string) => boolean; ttl: number }> = [
  { test: (pathname) => pathname === '/', ttl: 30 },
  { test: (pathname) => pathname === '/articles' || pathname === '/articles/', ttl: 60 },
  { test: (pathname) => pathname.startsWith('/posts/'), ttl: 60 },
  { test: (pathname) => pathname === '/tags' || pathname === '/tags/' || pathname.startsWith('/tags/'), ttl: 300 },
  { test: (pathname) => pathname === '/timeline' || pathname === '/timeline/', ttl: 300 },
  { test: (pathname) => pathname === '/rss.xml', ttl: 600 },
  { test: (pathname) => pathname === '/sitemap.xml', ttl: 3600 },
  { test: (pathname) => pathname === '/robots.txt', ttl: 86400 }
];

const PUBLIC_CACHE_CONTENT_TYPES = [
  'text/html',
  'application/rss+xml',
  'application/xml',
  'text/xml',
  'text/plain'
];

function hasAdminSessionCookie(request: Request): boolean {
  const cookie = request.headers.get('cookie');
  return Boolean(cookie && cookie.split(';').some((item) => item.trim().startsWith(`${SESSION_COOKIE_NAME}=`)));
}

function getTtl(pathname: string): number | null {
  return PUBLIC_CACHE_TTLS.find((item) => item.test(pathname))?.ttl ?? null;
}

function normalizeArticlesPage(value: string | null): string | null | false {
  const page = Number.parseInt(value ?? '1', 10);
  const normalized = Number.isFinite(page) && page > 1 ? page : 1;
  if (normalized > 100) {
    return false;
  }
  return normalized > 1 ? String(normalized) : null;
}

function createCacheUrl(url: URL): URL | null {
  const normalized = new URL(url.origin);
  const pathname = url.pathname.endsWith('/') && url.pathname !== '/' ? url.pathname.slice(0, -1) : url.pathname;
  normalized.pathname = pathname;

  if (pathname === '/articles') {
    const page = normalizeArticlesPage(url.searchParams.get('page'));
    if (page === false) {
      return null;
    }
    if (page) {
      normalized.searchParams.set('page', page);
    }
  }

  if (
    pathname === '/' ||
    pathname === '/articles' ||
    pathname === '/timeline' ||
    pathname === '/tags' ||
    pathname.startsWith('/tags/') ||
    pathname.startsWith('/posts/') ||
    pathname === '/rss.xml' ||
    pathname === '/sitemap.xml' ||
    pathname === '/robots.txt'
  ) {
    return normalized;
  }

  return null;
}

export function shouldForceNoStore(request: Request, url: URL): boolean {
  const pathname = url.pathname;

  if (pathname.startsWith('/admin') || pathname.startsWith('/api') || pathname === '/write' || pathname.startsWith('/write/') || pathname === '/settings' || pathname.startsWith('/settings/')) {
    return true;
  }

  return url.searchParams.get('fresh') === '1' || hasAdminSessionCookie(request);
}

export function getPublicCacheContext(request: Request, url: URL): { cacheKey: Request; ttl: number } | null {
  if (request.method !== 'GET' || shouldForceNoStore(request, url)) {
    return null;
  }

  const ttl = getTtl(url.pathname.endsWith('/') && url.pathname !== '/' ? url.pathname.slice(0, -1) : url.pathname);

  if (!ttl) {
    return null;
  }

  const cacheUrl = createCacheUrl(url);

  if (!cacheUrl) {
    return null;
  }

  return {
    cacheKey: new Request(cacheUrl.toString(), { method: 'GET' }),
    ttl
  };
}

function cloneWithHeaders(response: Response, headers: Headers): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function withServerTiming(response: Response, startedAt: number): Response {
  const headers = new Headers(response.headers);
  const duration = Math.max(0, performance.now() - startedAt).toFixed(1);
  headers.set('Server-Timing', `app;dur=${duration}`);
  return cloneWithHeaders(response, headers);
}

export function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return cloneWithHeaders(response, headers);
}

export async function matchPublicCache(request: Request, url: URL): Promise<Response | null> {
  const cacheContext = getPublicCacheContext(request, url);

  if (!cacheContext || typeof caches === 'undefined') {
    return null;
  }

  try {
    const cached = await caches.default.match(cacheContext.cacheKey);

    if (!cached) {
      return null;
    }

    const headers = new Headers(cached.headers);
    headers.set('X-Sakura-Cache', 'HIT');
    return cloneWithHeaders(cached.clone(), headers);
  } catch {
    return null;
  }
}

export async function maybeStorePublicCache(request: Request, url: URL, response: Response): Promise<Response> {
  if (shouldForceNoStore(request, url)) {
    return withNoStore(response);
  }

  const cacheContext = getPublicCacheContext(request, url);

  if (!cacheContext || response.status !== 200 || response.headers.has('Set-Cookie')) {
    return response;
  }

  const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';

  if (!PUBLIC_CACHE_CONTENT_TYPES.some((value) => contentType.includes(value))) {
    return response;
  }

  const cacheControl = `public, max-age=0, s-maxage=${cacheContext.ttl}, stale-while-revalidate=${cacheContext.ttl}`;
  const clientHeaders = new Headers(response.headers);
  clientHeaders.set('Cache-Control', cacheControl);
  clientHeaders.set('X-Sakura-Cache', 'MISS');

  const cacheHeaders = new Headers(clientHeaders);
  const responseForCache = cloneWithHeaders(response.clone(), cacheHeaders);

  if (typeof caches !== 'undefined') {
    try {
      await caches.default.put(cacheContext.cacheKey, responseForCache);
    } catch {
      // Cache API failures should not affect page rendering.
    }
  }

  return cloneWithHeaders(response, clientHeaders);
}
