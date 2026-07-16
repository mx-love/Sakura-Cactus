import { nowIso } from '@/lib/db';
import type { SiteSettingRow } from './settings.types';

export async function listSiteSettings(db: D1Database): Promise<SiteSettingRow[]> {
  const result = await db.prepare('SELECT key, value, updated_at FROM site_settings').all<SiteSettingRow>();
  return result.results ?? [];
}

export async function upsertSiteSetting(db: D1Database, key: string, value: string): Promise<void> {
  const now = nowIso();

  await db
    .prepare(
      `INSERT INTO site_settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(key, value, now)
    .run();
}

export async function upsertSiteSettings(db: D1Database, entries: Array<[string, string]>): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const now = nowIso();
  const statements = entries.map(([key, value]) =>
    db
      .prepare(
        `INSERT INTO site_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .bind(key, value, now)
  );

  await db.batch(statements);
}

export async function incrementPostViewCount(db: D1Database, postId: string): Promise<number> {
  const now = nowIso();

  await db
    .prepare(
      `INSERT INTO post_view_counts (post_id, count, updated_at)
       VALUES (?, 1, ?)
       ON CONFLICT(post_id) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`
    )
    .bind(postId, now)
    .run();

  const row = await db.prepare('SELECT count FROM post_view_counts WHERE post_id = ?').bind(postId).first<{ count: number }>();
  return row?.count ?? 0;
}

export async function incrementPublicPostViewCount(db: D1Database, postId: string, nowIsoValue: string): Promise<number | null> {
  const post = await db
    .prepare(
      `SELECT id
       FROM posts
       WHERE id = ?
         AND status = 'published'
         AND visibility = 'public'
         AND published_at IS NOT NULL
         AND published_at <= ?
       LIMIT 1`
    )
    .bind(postId, nowIsoValue)
    .first<{ id: string }>();

  if (!post) {
    return null;
  }

  return incrementPostViewCount(db, postId);
}

export async function getPostViewCount(db: D1Database, postId: string): Promise<number> {
  const row = await db.prepare('SELECT count FROM post_view_counts WHERE post_id = ?').bind(postId).first<{ count: number }>();
  return row?.count ?? 0;
}
