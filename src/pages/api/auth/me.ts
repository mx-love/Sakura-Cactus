import type { APIRoute } from 'astro';
import { getCurrentAdminUser } from '@/features/auth/auth.service';
import { jsonError, jsonOk } from '@/lib/response';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const user = await getCurrentAdminUser(context);

  if (!user) {
    return jsonError('AUTH_REQUIRED', 'Authentication required.', { status: 401 });
  }

  return jsonOk({
    user
  });
};
