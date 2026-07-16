import type { APIRoute } from 'astro';
import { getBlogDataSummary } from '@/features/data-portability/data-portability.service';
import { jsonOk } from '@/lib/response';

export const prerender = false;

export const GET: APIRoute = async () => {
  const summary = await getBlogDataSummary();
  return jsonOk({ summary });
};
