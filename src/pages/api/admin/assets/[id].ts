import type { APIRoute } from 'astro';
import {
  deleteAdminAsset,
  getAdminAsset,
  isAssetValidationError,
  setAdminAssetVisibility
} from '@/features/assets/asset.service';
import type { AssetVisibility } from '@/features/assets/asset.types';
import { jsonError, jsonOk } from '@/lib/response';

export const prerender = false;

function getId(params: Record<string, string | undefined>): string | null {
  const id = params.id?.trim();
  return id && id.length > 0 ? id : null;
}

export const GET: APIRoute = async ({ params }) => {
  const id = getId(params);

  if (!id) {
    return jsonError('ASSET_NOT_FOUND', 'Asset not found.', { status: 404 });
  }

  const asset = await getAdminAsset(id);

  if (!asset) {
    return jsonError('ASSET_NOT_FOUND', 'Asset not found.', { status: 404 });
  }

  return jsonOk({ asset });
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = getId(params);

  if (!id) {
    return jsonError('ASSET_NOT_FOUND', 'Asset not found.', { status: 404 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError('INVALID_JSON', 'Invalid JSON payload.', { status: 400 });
  }

  if (!body || typeof body !== 'object' || typeof (body as Record<string, unknown>).visibility !== 'string') {
    return jsonError('INVALID_VISIBILITY', 'Invalid asset visibility.', { status: 400 });
  }

  try {
    const asset = await setAdminAssetVisibility(
      id,
      (body as Record<string, unknown>).visibility as Exclude<AssetVisibility, 'deleted'>
    );

    if (!asset) {
      return jsonError('ASSET_NOT_FOUND', 'Asset not found.', { status: 404 });
    }

    return jsonOk({ asset });
  } catch (error) {
    if (isAssetValidationError(error)) {
      return jsonError(error.code, error.message, { status: 400 });
    }

    console.error('Asset update failed:', error);
    return jsonError('ASSET_UPDATE_FAILED', 'Unable to update asset.', { status: 500 });
  }
};

export const DELETE: APIRoute = async ({ params }) => {
  const id = getId(params);

  if (!id) {
    return jsonError('ASSET_NOT_FOUND', 'Asset not found.', { status: 404 });
  }

  try {
    const asset = await deleteAdminAsset(id);

    if (!asset) {
      return jsonError('ASSET_NOT_FOUND', 'Asset not found.', { status: 404 });
    }

    return jsonOk({ asset });
  } catch (error) {
    if (isAssetValidationError(error)) {
      return jsonError(error.code, error.message, { status: 400 });
    }

    console.error('Asset delete failed:', error);
    return jsonError('ASSET_DELETE_FAILED', 'Unable to delete asset.', { status: 500 });
  }
};
