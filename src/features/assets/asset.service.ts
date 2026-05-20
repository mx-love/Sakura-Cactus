import { env } from 'cloudflare:workers';
import { bytesToBase64Url, createRandomToken } from '@/features/auth/crypto.service';
import type { PublicAdminUser } from '@/features/auth/auth.service';
import { getDb } from '@/lib/db';
import { assertValidImageFile, extensionForMimeType, isValidAssetToken, AssetValidationError } from './asset.security';
import {
  createAssetRecord,
  findAssetById,
  findAssetByToken,
  isAssetReferencedByAnyPost,
  isAssetUsedByPublishedPublicPost,
  listAssets,
  softDeleteAsset,
  updateAssetVisibility
} from './asset.repo';
import type { AssetRow, AssetVisibility } from './asset.types';

const TOKEN_BYTES = 24;

export function getMediaBucket(): R2Bucket {
  const bucket = env.MEDIA_BUCKET;

  if (!bucket) {
    throw new Error('Cloudflare R2 binding "MEDIA_BUCKET" is not available.');
  }

  return bucket;
}

export function isAssetValidationError(error: unknown): error is AssetValidationError {
  return error instanceof AssetValidationError;
}

export class AssetStorageError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'AssetStorageError';
  }
}

export function isAssetStorageError(error: unknown): error is AssetStorageError {
  return error instanceof AssetStorageError;
}

function buildR2Key(mimeType: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const id = createRandomToken(16);
  return `assets/${year}/${month}/${id}.${extensionForMimeType(mimeType)}`;
}

async function sha256ArrayBuffer(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function getAdminAssets(): Promise<AssetRow[]> {
  return listAssets(getDb());
}

export async function getAdminAsset(id: string): Promise<AssetRow | null> {
  const asset = await findAssetById(getDb(), id);
  return asset && !asset.deleted_at ? asset : null;
}

export async function uploadAdminAsset(file: File, user: PublicAdminUser): Promise<AssetRow> {
  assertValidImageFile(file);

  const db = getDb();
  const bucket = getMediaBucket();
  const buffer = await file.arrayBuffer();
  const token = createRandomToken(TOKEN_BYTES);
  const r2Key = buildR2Key(file.type);
  const sha256 = await sha256ArrayBuffer(buffer);

  await bucket.put(r2Key, buffer, {
    httpMetadata: {
      contentType: file.type
    },
    customMetadata: {
      originalFilename: file.name
    }
  });

  return createAssetRecord(db, {
    token,
    r2Key,
    originalFilename: file.name || null,
    mimeType: file.type,
    sizeBytes: file.size,
    sha256,
    createdBy: user.id
  });
}

export async function setAdminAssetVisibility(
  id: string,
  visibility: Exclude<AssetVisibility, 'deleted'>
): Promise<AssetRow | null> {
  if (!['draft', 'public', 'private'].includes(visibility)) {
    throw new AssetValidationError('INVALID_VISIBILITY', 'Invalid asset visibility.');
  }

  return updateAssetVisibility(getDb(), id, visibility);
}

export async function deleteAdminAsset(id: string): Promise<AssetRow | null> {
  const db = getDb();
  const isReferenced = await isAssetReferencedByAnyPost(db, id);

  if (isReferenced) {
    throw new AssetValidationError('ASSET_IN_USE', 'Remove this image from posts before deleting it.');
  }

  const asset = await findAssetById(db, id);

  if (!asset || asset.deleted_at) {
    return null;
  }

  return deleteAssetObjectAndSoftDelete(db, asset);
}

export async function deleteAssetObjectAndSoftDelete(db: D1Database, asset: AssetRow): Promise<AssetRow | null> {
  try {
    await getMediaBucket().delete(asset.r2_key);
  } catch (error) {
    console.error('R2 asset delete failed:', error);
    throw new AssetStorageError('R2_DELETE_FAILED', 'Unable to delete image object from storage.');
  }

  return softDeleteAsset(db, asset.id);
}

export async function cleanupUnreferencedAssets(db: D1Database, assets: AssetRow[]): Promise<void> {
  for (const asset of assets) {
    const isReferenced = await isAssetReferencedByAnyPost(db, asset.id);

    if (!isReferenced && !asset.deleted_at) {
      await deleteAssetObjectAndSoftDelete(db, asset);
    }
  }
}

export async function getAssetForToken(
  token: string,
  user: PublicAdminUser | null
): Promise<{ asset: AssetRow; object: R2ObjectBody; isPublic: boolean } | null> {
  if (!isValidAssetToken(token)) {
    return null;
  }

  const db = getDb();
  const asset = await findAssetByToken(db, token);

  if (!asset || asset.deleted_at || asset.visibility === 'deleted') {
    return null;
  }

  const isDirectlyPublic = asset.visibility === 'public';
  const isUsedByPublicPost = await isAssetUsedByPublishedPublicPost(db, asset.id);
  const isPublic = isDirectlyPublic || isUsedByPublicPost;

  if (!isPublic && !user) {
    return null;
  }

  const object = await getMediaBucket().get(asset.r2_key);

  if (!object) {
    return null;
  }

  return {
    asset,
    object,
    isPublic
  };
}
