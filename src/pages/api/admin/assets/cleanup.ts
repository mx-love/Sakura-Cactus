import type { APIRoute } from 'astro';
import { cleanupExpiredDraftAssets } from '@/features/assets/asset.service';
import { jsonError, jsonOk } from '@/lib/response';

export const prerender = false;

export const POST: APIRoute = async () => {
  try {
    const stats = await cleanupExpiredDraftAssets();
    return jsonOk(stats);
  } catch (error) {
    console.error('Asset cleanup failed:', error);
    return jsonError('ASSET_CLEANUP_FAILED', 'Unable to cleanup expired images.', { status: 500 });
  }
};
