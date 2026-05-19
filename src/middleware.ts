import { defineMiddleware } from 'astro:middleware';
import { getCurrentAdminUser } from '@/features/auth/auth.service';
import { jsonError } from '@/lib/response';

function isAdminPage(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

function isAdminLoginPage(pathname: string): boolean {
  return pathname === '/admin/login' || pathname === '/admin/login/';
}

function isAdminApi(pathname: string): boolean {
  return pathname === '/api/admin' || pathname.startsWith('/api/admin/');
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  if (isAdminApi(pathname)) {
    const user = await getCurrentAdminUser(context);

    if (!user) {
      return jsonError('AUTH_REQUIRED', 'Authentication required.', { status: 401 });
    }

    return next();
  }

  if (isAdminPage(pathname)) {
    const user = await getCurrentAdminUser(context);

    if (isAdminLoginPage(pathname)) {
      if (user) {
        return context.redirect('/admin');
      }

      return next();
    }

    if (!user) {
      const nextPath = `${pathname}${context.url.search}`;
      return context.redirect(`/admin/login?next=${encodeURIComponent(nextPath)}`);
    }
  }

  return next();
});
