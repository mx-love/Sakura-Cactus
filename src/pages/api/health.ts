import type { APIRoute } from 'astro';
import { jsonOk } from '@/lib/response';

export const prerender = false;

export const GET: APIRoute = () => {
  return jsonOk({
    status: 'ok',
    service: 'sakura-cactus'
  });
};
