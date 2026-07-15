import type { APIRoute } from 'astro';
import { cleanupExpiredDraftAssets } from '@/features/assets/asset.service';
import { jsonError, jsonOk } from '@/lib/response';
import { reportError } from '@/lib/logging';

export const prerender = false;

export const POST: APIRoute = async () => {
  try {
    const stats = await cleanupExpiredDraftAssets();
    return jsonOk(stats);
  } catch (error) {
    reportError('Asset cleanup failed.', error);
    return jsonError('ASSET_CLEANUP_FAILED', 'Unable to cleanup expired images.', { status: 500 });
  }
};
