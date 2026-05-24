import { defineMiddleware } from 'astro:middleware';
import { getCurrentAdminUser } from '@/features/auth/auth.service';
import { matchPublicCache, maybeStorePublicCache, shouldForceNoStore, withNoStore, withServerTiming } from '@/lib/cache';
import { getDb } from '@/lib/db';
import { jsonError } from '@/lib/response';
import { ensureD1Schema } from '@/lib/schema';

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

export const onRequest = defineMiddleware(async (context, next) => {
  const startedAt = performance.now();
  const { pathname } = context.url;
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
      return withServerTiming(context.redirect('/admin/login'), startedAt);
    }

    const user = await getCurrentAdminUser(context);

    if (isAdminLoginPage(pathname)) {
      if (user) {
        return withServerTiming(context.redirect('/admin'), startedAt);
      }

      return withServerTiming(withNoStore(await next()), startedAt);
    }

    if (!user) {
      const nextPath = `${pathname}${context.url.search}`;
      return withServerTiming(context.redirect(`/admin/login?next=${encodeURIComponent(nextPath)}`), startedAt);
    }
  }

  const response = await next();
  return withServerTiming(await maybeStorePublicCache(context.request, context.url, response), startedAt);
});
