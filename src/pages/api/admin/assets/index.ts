import type { APIRoute } from 'astro';
import { getAdminAssets } from '@/features/assets/asset.service';
import { jsonOk } from '@/lib/response';

export const prerender = false;

export const GET: APIRoute = async () => {
  const assets = await getAdminAssets();
  return jsonOk({ assets });
};
