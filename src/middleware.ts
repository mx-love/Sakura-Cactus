import { defineMiddleware } from 'astro:middleware';
import { getCurrentAdminUser } from '@/features/auth/auth.service';
import { matchPublicCache, maybeStorePublicCache, shouldForceNoStore, withNoStore, withServerTiming } from '@/lib/cache';
import { getDb } from '@/lib/db';
import { jsonError } from '@/lib/response';
import { ensureD1Schema } from '@/lib/schema';
import { ROBOTS_NOINDEX_NOFOLLOW, getCanonicalRedirectUrl } from '@/lib/seo';

function isAdminPage(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

function isAdminLoginPage(pathname: string): boolean {
  return pathname === '/admin/login' || pathname === '/admin/login/';
}

function isAdminSetupPage(pathname: string): boolean {
  return pathname === '/admin/setup' || pathname === '/admin/setup/';
}

function isAdminApi(pathname: string): boolean {
  return pathname === '/api/admin' || pathname.startsWith('/api/admin/');
}

function isPrivateHtmlPage(pathname: string): boolean {
  return (
    isAdminPage(pathname) ||
    pathname === '/write' ||
    pathname.startsWith('/write/') ||
    pathname === '/settings' ||
    pathname.startsWith('/settings/')
  );
}

function withRobotsTag(response: Response, value: string): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function withPrivateRobots(response: Response): Response {
  return withRobotsTag(response, ROBOTS_NOINDEX_NOFOLLOW);
}

export const onRequest = defineMiddleware(async (context, next) => {
  const startedAt = performance.now();
  const { pathname } = context.url;
  const canonicalRedirectUrl = getCanonicalRedirectUrl(context.url);

  if (canonicalRedirectUrl && (context.request.method === 'GET' || context.request.method === 'HEAD')) {
    return withServerTiming(Response.redirect(canonicalRedirectUrl, 308), startedAt);
  }

  const cached = await matchPublicCache(context.request, context.url);

  if (cached) {
    return withServerTiming(cached, startedAt);
  }

  await ensureD1Schema(getDb());

  if (isAdminApi(pathname)) {
    const user = await getCurrentAdminUser(context);

    if (!user) {
      return withServerTiming(jsonError('AUTH_REQUIRED', 'Authentication required.', { status: 401 }), startedAt);
    }

    const response = await next();
    return withServerTiming(shouldForceNoStore(context.request, context.url) ? withNoStore(response) : response, startedAt);
  }

  if (isAdminPage(pathname)) {
    if (isAdminSetupPage(pathname)) {
      return withServerTiming(withPrivateRobots(context.redirect('/admin/login')), startedAt);
    }

    const user = await getCurrentAdminUser(context);

    if (isAdminLoginPage(pathname)) {
      if (user) {
        return withServerTiming(withPrivateRobots(context.redirect('/admin')), startedAt);
      }

      return withServerTiming(withPrivateRobots(withNoStore(await next())), startedAt);
    }

    if (!user) {
      const nextPath = `${pathname}${context.url.search}`;
      return withServerTiming(withPrivateRobots(context.redirect(`/admin/login?next=${encodeURIComponent(nextPath)}`)), startedAt);
    }
  }

  const response = await next();
  const cachedResponse = await maybeStorePublicCache(context.request, context.url, response);
  return withServerTiming(isPrivateHtmlPage(pathname) ? withPrivateRobots(cachedResponse) : cachedResponse, startedAt);
});
