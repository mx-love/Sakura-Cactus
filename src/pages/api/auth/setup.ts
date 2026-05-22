import type { APIRoute } from 'astro';
import { jsonError } from '@/lib/response';

export const prerender = false;

export const POST: APIRoute = async () => {
  return jsonError('NOT_FOUND', 'Not found.', { status: 404 });
};
