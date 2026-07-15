import type { APIRoute } from 'astro';
import { cleanupExpiredDraftAssets } from '@/features/assets/asset.service';
import { updateMaintenanceLastRunAt } from '@/features/settings/settings.service';
import { jsonError, jsonOk } from '@/lib/response';
import { reportError } from '@/lib/logging';

export const prerender = false;

export const POST: APIRoute = async () => {
  try {
    const stats = await cleanupExpiredDraftAssets();
    await updateMaintenanceLastRunAt();
    return jsonOk({ stats });
  } catch (error) {
    reportError('Maintenance asset cleanup failed.', error);
    return jsonError('MAINTENANCE_CLEANUP_FAILED', 'Unable to cleanup expired images.', { status: 500 });
  }
};
