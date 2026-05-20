import type { AssetRow, AssetVisibility } from '@/lib/database.types';
import { nowIso } from '@/lib/db';
import { createRandomId } from '@/features/auth/crypto.service';
import type { CreateAssetRecordInput } from './asset.types';

export async function listAssets(db: D1Database): Promise<AssetRow[]> {
  const result = await db
    .prepare(
      `SELECT id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
        visibility, usage_count, created_by, created_at, updated_at, deleted_at
       FROM assets
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 100`
    )
    .all<AssetRow>();

  return result.results ?? [];
}

export async function findAssetById(db: D1Database, id: string): Promise<AssetRow | null> {
  return db
    .prepare(
      `SELECT id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
        visibility, usage_count, created_by, created_at, updated_at, deleted_at
       FROM assets
       WHERE id = ?
       LIMIT 1`
    )
    .bind(id)
    .first<AssetRow>();
}

export async function findAssetByToken(db: D1Database, token: string): Promise<AssetRow | null> {
  return db
    .prepare(
      `SELECT id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
        visibility, usage_count, created_by, created_at, updated_at, deleted_at
       FROM assets
       WHERE token = ?
       LIMIT 1`
    )
    .bind(token)
    .first<AssetRow>();
}

export async function findAssetsByTokens(db: D1Database, tokens: string[]): Promise<AssetRow[]> {
  const assets: AssetRow[] = [];

  for (const token of tokens) {
    const asset = await findAssetByToken(db, token);

    if (asset && !asset.deleted_at && asset.visibility !== 'deleted') {
      assets.push(asset);
    }
  }

  return assets;
}

export async function createAssetRecord(db: D1Database, input: CreateAssetRecordInput): Promise<AssetRow> {
  const now = nowIso();
  const asset: AssetRow = {
    id: createRandomId('asset'),
    token: input.token,
    r2_key: input.r2Key,
    original_filename: input.originalFilename,
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
    width: null,
    height: null,
    sha256: input.sha256,
    visibility: 'draft',
    usage_count: 0,
    created_by: input.createdBy,
    created_at: now,
    updated_at: now,
    deleted_at: null
  };

  await db
    .prepare(
      `INSERT INTO assets (
        id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
        visibility, usage_count, created_by, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      asset.id,
      asset.token,
      asset.r2_key,
      asset.original_filename,
      asset.mime_type,
      asset.size_bytes,
      asset.width,
      asset.height,
      asset.sha256,
      asset.visibility,
      asset.usage_count,
      asset.created_by,
      asset.created_at,
      asset.updated_at,
      asset.deleted_at
    )
    .run();

  return asset;
}

export async function updateAssetVisibility(
  db: D1Database,
  id: string,
  visibility: Exclude<AssetVisibility, 'deleted'>
): Promise<AssetRow | null> {
  const now = nowIso();

  await db
    .prepare(
      `UPDATE assets
       SET visibility = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`
    )
    .bind(visibility, now, id)
    .run();

  return findAssetById(db, id);
}

export async function makeAssetsPublic(db: D1Database, assetIds: string[]): Promise<void> {
  const now = nowIso();

  for (const assetId of assetIds) {
    await db
      .prepare(
        `UPDATE assets
         SET visibility = 'public', updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`
      )
      .bind(now, assetId)
      .run();
  }
}

export async function softDeleteAsset(db: D1Database, id: string): Promise<AssetRow | null> {
  const existing = await findAssetById(db, id);

  if (!existing || existing.deleted_at) {
    return null;
  }

  const now = nowIso();

  await db
    .prepare(
      `UPDATE assets
       SET visibility = 'deleted', deleted_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`
    )
    .bind(now, now, id)
    .run();

  return {
    ...existing,
    visibility: 'deleted',
    deleted_at: now,
    updated_at: now
  };
}

export async function isAssetUsedByPublishedPublicPost(db: D1Database, assetId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT post_assets.asset_id
       FROM post_assets
       INNER JOIN posts ON posts.id = post_assets.post_id
       WHERE post_assets.asset_id = ?
         AND posts.status = 'published'
         AND posts.visibility = 'public'
         AND posts.deleted_at IS NULL
       LIMIT 1`
    )
    .bind(assetId)
    .first<{ asset_id: string }>();

  return Boolean(row);
}

export async function isAssetReferencedByAnyPost(db: D1Database, assetId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT asset_id
       FROM post_assets
       WHERE asset_id = ?
       LIMIT 1`
    )
    .bind(assetId)
    .first<{ asset_id: string }>();

  return Boolean(row);
}
