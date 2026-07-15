import type { APIRoute } from 'astro';
import { createExpiredSessionCookie, logoutAdmin } from '@/features/auth/auth.service';
import { reportError } from '@/lib/logging';
import { jsonError } from '@/lib/response';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  try {
    await logoutAdmin(context);
  } catch (error) {
    reportError('Admin logout failed.', error);
    return jsonError('LOGOUT_FAILED', 'Unable to sign out right now.', { status: 500 });
  }

  return Response.json(
    {
      ok: true
    },
    {
      headers: {
        'Set-Cookie': createExpiredSessionCookie()
      }
    }
  );
};
