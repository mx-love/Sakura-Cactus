import type { APIContext } from 'astro';
import { jsonError } from '@/lib/response';
import { getCurrentAdminUser } from './auth.service';

export async function requireAdminUser(context: APIContext): Promise<Response | null> {
  const user = await getCurrentAdminUser(context);

  if (!user) {
    return jsonError('AUTH_REQUIRED', 'Authentication required.', { status: 401 });
  }

  return null;
}
