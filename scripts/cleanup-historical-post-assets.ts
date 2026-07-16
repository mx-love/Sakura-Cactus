import { fileURLToPath } from 'node:url';

type CandidateDbValue = string | number | null;

interface CandidateStatement {
  bind(...values: CandidateDbValue[]): CandidateStatement;
  run(): Promise<{ meta?: { changes?: number } }>;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results?: T[] }>;
}

export interface CandidateCleanupDb {
  prepare(query: string): CandidateStatement;
  batch<T = unknown>(statements: CandidateStatement[]): Promise<T[]>;
}

export interface CandidateCleanupBucket {
  delete(key: string): Promise<void>;
}

export interface HistoricalPostAssetCleanupStats {
  scanned: number;
  deleted: number;
  skippedReferenced: number;
  missingAsset: number;
  failed: number;
}

interface CandidateRow {
  asset_id: string;
  r2_key: string | null;
}

async function isAssetStillReferenced(db: CandidateCleanupDb, assetId: string): Promise<boolean> {
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

async function deleteCandidate(db: CandidateCleanupDb, assetId: string): Promise<void> {
  await db.prepare('DELETE FROM historical_post_asset_cleanup_candidates WHERE asset_id = ?').bind(assetId).run();
}

export async function cleanupHistoricalPostAssetCandidates(
  db: CandidateCleanupDb,
  bucket: CandidateCleanupBucket,
  options: { limit?: number } = {}
): Promise<HistoricalPostAssetCleanupStats> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const candidates = await db
    .prepare(
      `SELECT candidates.asset_id, assets.r2_key
       FROM historical_post_asset_cleanup_candidates candidates
       LEFT JOIN assets ON assets.id = candidates.asset_id
       ORDER BY candidates.created_at ASC, candidates.asset_id ASC
       LIMIT ?`
    )
    .bind(limit)
    .all<CandidateRow>();
  const rows = candidates.results ?? [];
  const stats: HistoricalPostAssetCleanupStats = {
    scanned: rows.length,
    deleted: 0,
    skippedReferenced: 0,
    missingAsset: 0,
    failed: 0
  };

  for (const row of rows) {
    if (!row.r2_key) {
      await deleteCandidate(db, row.asset_id);
      stats.missingAsset += 1;
      continue;
    }

    if (await isAssetStillReferenced(db, row.asset_id)) {
      await deleteCandidate(db, row.asset_id);
      stats.skippedReferenced += 1;
      continue;
    }

    try {
      await bucket.delete(row.r2_key);
      await db.batch([
        db
          .prepare(
            `DELETE FROM assets
             WHERE id = ?
               AND NOT EXISTS (SELECT 1 FROM post_assets WHERE asset_id = ?)
               AND NOT EXISTS (SELECT 1 FROM posts WHERE cover_asset_id = ?)`
          )
          .bind(row.asset_id, row.asset_id, row.asset_id),
        db
          .prepare(
            `DELETE FROM historical_post_asset_cleanup_candidates
             WHERE asset_id = ?
               AND NOT EXISTS (SELECT 1 FROM post_assets WHERE asset_id = ?)
               AND NOT EXISTS (SELECT 1 FROM posts WHERE cover_asset_id = ?)`
          )
          .bind(row.asset_id, row.asset_id, row.asset_id)
      ]);

      if (await isAssetStillReferenced(db, row.asset_id)) {
        stats.skippedReferenced += 1;
      } else {
        stats.deleted += 1;
      }
    } catch (error) {
      stats.failed += 1;
      console.error('Historical post asset cleanup failed.', {
        assetId: row.asset_id,
        r2Key: row.r2_key,
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return stats;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.error(
    [
      'This module is a local compensation helper and does not connect to remote D1/R2 automatically.',
      'Import cleanupHistoricalPostAssetCandidates(db, bucket) from a local Worker/test harness with explicit bindings.'
    ].join('\n')
  );
  process.exitCode = 1;
}
