import { defineMiddleware } from 'astro:middleware';
import { getCurrentAdminUser } from '@/features/auth/auth.service';
import { matchPublicCache, maybeStorePublicCache, shouldForceNoStore, withNoStore } from '@/lib/cache';
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
  const { pathname } = context.url;
  const cached = await matchPublicCache(context.request, context.url);

  if (cached) {
    return cached;
  }

  await ensureD1Schema(getDb());

  if (isAdminApi(pathname)) {
    const user = await getCurrentAdminUser(context);

    if (!user) {
      return jsonError('AUTH_REQUIRED', 'Authentication required.', { status: 401 });
    }

    const response = await next();
    return shouldForceNoStore(context.request, context.url) ? withNoStore(response) : response;
  }

  if (isAdminPage(pathname)) {
    if (isAdminSetupPage(pathname)) {
      return context.redirect('/admin/login');
    }

    const user = await getCurrentAdminUser(context);

    if (isAdminLoginPage(pathname)) {
      if (user) {
        return context.redirect('/admin');
      }

      return withNoStore(await next());
    }

    if (!user) {
      const nextPath = `${pathname}${context.url.search}`;
      return context.redirect(`/admin/login?next=${encodeURIComponent(nextPath)}`);
    }
  }

  const response = await next();
  return maybeStorePublicCache(context.request, context.url, response);
});
