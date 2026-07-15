import type { APIRoute } from 'astro';
import { cleanupUnsavedDraftAssetsByTokens } from '@/features/assets/asset.service';
import { jsonError, jsonOk } from '@/lib/response';
import { reportError } from '@/lib/logging';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError('INVALID_JSON', 'Invalid JSON payload.', { status: 400 });
  }

  const tokens = body && typeof body === 'object' ? (body as Record<string, unknown>).tokens : null;

  if (!Array.isArray(tokens)) {
    return jsonError('INVALID_TOKENS', 'Tokens must be an array.', { status: 400 });
  }

  try {
    const stats = await cleanupUnsavedDraftAssetsByTokens(tokens.filter((token): token is string => typeof token === 'string'));
    return jsonOk(stats);
  } catch (error) {
    reportError('Unsaved asset cleanup failed.', error);
    return jsonError('UNSAVED_ASSET_CLEANUP_FAILED', 'Unable to cleanup unsaved images.', { status: 500 });
  }
};
