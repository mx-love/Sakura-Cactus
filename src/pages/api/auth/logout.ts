import type { APIRoute } from 'astro';
import { createExpiredSessionCookie, logoutAdmin } from '@/features/auth/auth.service';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  await logoutAdmin(context);

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
