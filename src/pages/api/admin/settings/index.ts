import type { APIRoute } from 'astro';
import { getSiteSettings, isSiteSettingsValidationError, updateSiteSettings } from '@/features/settings/settings.service';
import type { SiteSettingsInput } from '@/features/settings/settings.types';
import { jsonError, jsonOk } from '@/lib/response';
import { reportError } from '@/lib/logging';
import { capturePublicCacheState, invalidatePublicCache } from '@/lib/public-cache-invalidation';

export const prerender = false;

export const GET: APIRoute = async () => {
  return jsonOk({ settings: await getSiteSettings() });
};

export const PATCH: APIRoute = async (context) => {
  const { request } = context;
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError('INVALID_JSON', 'Invalid JSON payload.', { status: 400 });
  }

  try {
    const cacheBefore = await capturePublicCacheState();
    const settings = await updateSiteSettings((body && typeof body === 'object' ? body : {}) as SiteSettingsInput);
    await invalidatePublicCache(context, { settings: true }, cacheBefore);
    return jsonOk({ settings });
  } catch (error) {
    if (isSiteSettingsValidationError(error)) {
      return jsonError(error.code, error.message, { status: 400 });
    }

    reportError('Settings update failed.', error);
    return jsonError('SETTINGS_UPDATE_FAILED', 'Unable to update settings.', { status: 500 });
  }
};
