import type { APIRoute } from 'astro';
import { getSiteSettings, isSiteSettingsValidationError, updateSiteSettings } from '@/features/settings/settings.service';
import type { SiteSettingsInput } from '@/features/settings/settings.types';
import { jsonError, jsonOk } from '@/lib/response';

export const prerender = false;

export const GET: APIRoute = async () => {
  return jsonOk({ settings: await getSiteSettings() });
};

export const PATCH: APIRoute = async ({ request }) => {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError('INVALID_JSON', 'Invalid JSON payload.', { status: 400 });
  }

  try {
    return jsonOk({ settings: await updateSiteSettings((body && typeof body === 'object' ? body : {}) as SiteSettingsInput) });
  } catch (error) {
    if (isSiteSettingsValidationError(error)) {
      return jsonError(error.code, error.message, { status: 400 });
    }

    console.error('Settings update failed:', error);
    return jsonError('SETTINGS_UPDATE_FAILED', 'Unable to update settings.', { status: 500 });
  }
};
