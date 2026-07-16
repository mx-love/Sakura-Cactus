import { defineMiddleware } from 'astro:middleware';
import { getCurrentAdminUser } from '@/features/auth/auth.service';
import { matchPublicCache, maybeStorePublicCache, withNoStore, withServerTiming } from '@/lib/cache';
import { jsonError } from '@/lib/response';
import { ROBOTS_NOINDEX_NOFOLLOW, getCanonicalRedirectUrl } from '@/lib/seo';
import { applySecurityHeaders, isMutatingRequest, isSameOriginBrowserRequest } from '@/lib/security/request';
import { DATA_PORTABILITY_LIMITS } from '@/features/data-portability/data-portability.constants';

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

function isProtectedHtmlPage(pathname: string): boolean {
  return isPrivateHtmlPage(pathname) && !isAdminLoginPage(pathname) && !isAdminSetupPage(pathname);
}

function requiresSameOriginMutation(pathname: string): boolean {
  return (
    isAdminApi(pathname) ||
    pathname === '/api/auth/login' ||
    pathname === '/api/auth/logout' ||
    pathname === '/api/friends/apply' ||
    pathname.startsWith('/api/views/')
  );
}

function exceedsRequestSizeLimit(request: Request, pathname: string): boolean {
  if (!isMutatingRequest(request) || !pathname.startsWith('/api/')) {
    return false;
  }

  const contentLength = Number(request.headers.get('content-length'));

  if (!Number.isFinite(contentLength) || contentLength < 0) {
    return false;
  }

  const maxBytes = pathname === '/api/admin/assets/upload'
    ? 6 * 1024 * 1024
    : pathname === '/api/admin/data-portability/inspect' || pathname === '/api/admin/data-portability/import'
      ? DATA_PORTABILITY_LIMITS.apiFileRequestBytes
      : pathname === '/api/admin/data-portability/export'
        ? DATA_PORTABILITY_LIMITS.apiJsonRequestBytes
        : 256 * 1024;
  return contentLength > maxBytes;
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
  const finalize = (response: Response, privateResponse = false) =>
    applySecurityHeaders(
      withServerTiming(privateResponse ? withNoStore(response) : response, startedAt),
      context.url,
      { privateResponse }
    );
  const canonicalRedirectUrl = getCanonicalRedirectUrl(context.url);

  if (canonicalRedirectUrl && (context.request.method === 'GET' || context.request.method === 'HEAD')) {
    return finalize(Response.redirect(canonicalRedirectUrl, 308));
  }

  const cached = await matchPublicCache(context.request, context.url);

  if (cached) {
    return finalize(cached);
  }

  if (isMutatingRequest(context.request) && requiresSameOriginMutation(pathname) && !isSameOriginBrowserRequest(context.request, context.url)) {
    return finalize(jsonError('CROSS_SITE_REQUEST_REJECTED', 'Cross-site request rejected.', { status: 403 }), true);
  }

  if (exceedsRequestSizeLimit(context.request, pathname)) {
    return finalize(jsonError('REQUEST_TOO_LARGE', 'Request body is too large.', { status: 413 }), true);
  }

  if (isAdminApi(pathname)) {
    const user = await getCurrentAdminUser(context);

    if (!user) {
      return finalize(jsonError('AUTH_REQUIRED', 'Authentication required.', { status: 401 }), true);
    }

    const response = await next();
    return finalize(withNoStore(response), true);
  }

  if (isAdminSetupPage(pathname)) {
    return finalize(withPrivateRobots(withNoStore(context.redirect('/admin/login'))), true);
  }

  if (isAdminLoginPage(pathname)) {
    const user = await getCurrentAdminUser(context);

    if (user) {
      return finalize(withPrivateRobots(withNoStore(context.redirect('/write'))), true);
    }

    return finalize(withPrivateRobots(withNoStore(await next())), true);
  }

  if (isProtectedHtmlPage(pathname)) {
    const user = await getCurrentAdminUser(context);

    if (!user) {
      const nextPath = `${pathname}${context.url.search}`;
      return finalize(withPrivateRobots(withNoStore(context.redirect(`/admin/login?next=${encodeURIComponent(nextPath)}`))), true);
    }
  }

  const response = await next();
  const cachedResponse = await maybeStorePublicCache(context.request, context.url, response);
  return finalize(isPrivateHtmlPage(pathname) ? withPrivateRobots(cachedResponse) : cachedResponse, isPrivateHtmlPage(pathname));
});
