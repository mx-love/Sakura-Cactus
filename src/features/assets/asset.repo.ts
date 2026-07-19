import type { AssetRow, AssetVisibility } from '@/lib/database.types';
import { nowIso } from '@/lib/db';
import { createRandomId } from '@/features/auth/crypto.service';
import type { CreateAssetRecordInput } from './asset.types';

const D1_IN_CHUNK_SIZE = 80;

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function chunkValues<T>(values: T[], size = D1_IN_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

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

export async function findReusableAssetBySha256(
  db: D1Database,
  sha256: string,
  mimeType: string,
  sizeBytes: number
): Promise<AssetRow | null> {
  return db
    .prepare(
      `SELECT id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
        visibility, usage_count, created_by, created_at, updated_at, deleted_at
       FROM assets
       WHERE sha256 = ?
         AND mime_type = ?
         AND size_bytes = ?
         AND deleted_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1`
    )
    .bind(sha256, mimeType, sizeBytes)
    .first<AssetRow>();
}

export async function findAssetsByTokens(db: D1Database, tokens: string[]): Promise<AssetRow[]> {
  const assets: AssetRow[] = [];
  const uniqueTokens = uniqueValues(tokens);

  for (const chunk of chunkValues(uniqueTokens)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await db
      .prepare(
        `SELECT id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
          visibility, usage_count, created_by, created_at, updated_at, deleted_at
         FROM assets
         WHERE token IN (${placeholders})
           AND deleted_at IS NULL
           AND visibility != 'deleted'`
      )
      .bind(...chunk)
      .all<AssetRow>();

    assets.push(...(result.results ?? []));
  }

  return assets;
}

export async function listExpiredUnusedDraftAssets(db: D1Database, cutoffIso: string): Promise<AssetRow[]> {
  const result = await db
    .prepare(
      `SELECT id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
        visibility, usage_count, created_by, created_at, updated_at, deleted_at
       FROM assets
       WHERE deleted_at IS NULL
         AND visibility = 'draft'
         AND usage_count = 0
         AND created_at < ?
       ORDER BY created_at ASC`
    )
    .bind(cutoffIso)
    .all<AssetRow>();

  return result.results ?? [];
}

export async function listUnusedDraftAssetsByTokens(db: D1Database, tokens: string[]): Promise<AssetRow[]> {
  const assets: AssetRow[] = [];
  const uniqueTokens = uniqueValues(tokens);

  for (const chunk of chunkValues(uniqueTokens)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await db
      .prepare(
        `SELECT id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
          visibility, usage_count, created_by, created_at, updated_at, deleted_at
         FROM assets
         WHERE token IN (${placeholders})
           AND deleted_at IS NULL
           AND visibility = 'draft'
           AND usage_count = 0`
      )
      .bind(...chunk)
      .all<AssetRow>();

    assets.push(...(result.results ?? []));
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
  const uniqueAssetIds = uniqueValues(assetIds);

  for (const chunk of chunkValues(uniqueAssetIds)) {
    const placeholders = chunk.map(() => '?').join(', ');
    await db
      .prepare(
        `UPDATE assets
         SET visibility = 'public', updated_at = ?
         WHERE id IN (${placeholders}) AND deleted_at IS NULL`
      )
      .bind(now, ...chunk)
      .run();
  }
}

export function getMakeAssetsPublicStatements(db: D1Database, assetIds: string[]): D1PreparedStatement[] {
  const now = nowIso();
  return chunkValues(uniqueValues(assetIds)).map((chunk) => {
    const placeholders = chunk.map(() => '?').join(', ');
    return db
      .prepare(
        `UPDATE assets
         SET visibility = 'public', updated_at = ?
         WHERE id IN (${placeholders}) AND deleted_at IS NULL`
      )
      .bind(now, ...chunk);
  });
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

export async function deleteAssetRecord(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM assets WHERE id = ? AND deleted_at IS NULL')
    .bind(id)
    .run();

  return (result.meta?.changes ?? 0) > 0;
}

export async function refreshAssetUsageCounts(db: D1Database, assetIds: string[]): Promise<AssetRow[]> {
  const uniqueAssetIds = uniqueValues(assetIds);
  const now = nowIso();
  const unusedAssets: AssetRow[] = [];
  const usageCounts = new Map<string, number>();

  for (const chunk of chunkValues(uniqueAssetIds)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await db
      .prepare(
        `SELECT asset_id, SUM(count) AS count
         FROM (
           SELECT asset_id, COUNT(*) AS count
           FROM post_assets
           WHERE asset_id IN (${placeholders})
           GROUP BY asset_id
           UNION ALL
           SELECT cover_asset_id AS asset_id, COUNT(*) AS count
           FROM posts
           WHERE cover_asset_id IN (${placeholders})
           GROUP BY cover_asset_id
         )
         WHERE asset_id IS NOT NULL
         GROUP BY asset_id`
      )
      .bind(...chunk, ...chunk)
      .all<{ asset_id: string; count: number }>();

    for (const row of result.results ?? []) {
      usageCounts.set(row.asset_id, row.count);
    }
  }

  for (const assetId of uniqueAssetIds) {
    const usageCount = usageCounts.get(assetId) ?? 0;

    if (usageCount === 0) {
      const asset = await findAssetById(db, assetId);

      if (asset && !asset.deleted_at) {
        unusedAssets.push({
          ...asset,
          usage_count: 0
        });
      }

      await db
        .prepare(
          `UPDATE assets
           SET usage_count = 0,
               updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`
        )
        .bind(now, assetId)
        .run();
    } else {
      await db
        .prepare(
          `UPDATE assets
           SET usage_count = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`
        )
        .bind(usageCount, now, assetId)
        .run();
    }
  }

  return unusedAssets;
}

export async function isAssetUsedByPublishedPublicPost(db: D1Database, assetId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT posts.id
       FROM posts
       LEFT JOIN post_assets ON post_assets.post_id = posts.id
       WHERE (post_assets.asset_id = ? OR posts.cover_asset_id = ?)
         AND posts.status = 'published'
         AND posts.visibility = 'public'
         AND posts.published_at IS NOT NULL
         AND posts.published_at <= ?
       LIMIT 1`
    )
    .bind(assetId, assetId, nowIso())
    .first<{ id: string }>();

  return Boolean(row);
}

export async function isAssetReferencedByAnyPost(db: D1Database, assetId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT asset_id
       FROM post_assets
       WHERE asset_id = ?
       UNION
       SELECT cover_asset_id AS asset_id
       FROM posts
       WHERE cover_asset_id = ?
       LIMIT 1`
    )
    .bind(assetId, assetId)
    .first<{ asset_id: string }>();

  return Boolean(row);
}
