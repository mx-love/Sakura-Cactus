import type { APIRoute } from 'astro';
import { createExpiredSessionCookie, logoutAdmin } from '@/features/auth/auth.service';
import { jsonOk } from '@/lib/response';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  await logoutAdmin(context);

  return jsonOk(
    {
      loggedOut: true
    },
    {
      headers: {
        'Set-Cookie': createExpiredSessionCookie()
      }
    }
  );
};
