import { refreshAssetUsageCounts } from '@/features/assets/asset.repo';
import type { AssetRow, PostRow } from '@/lib/database.types';
import { nowIso } from '@/lib/db';
import { createRandomId } from '@/features/auth/crypto.service';
import type { NormalizedPostInput } from './post.schema';
import type { PostListFilters, PostStatus, PostVisibility } from './post.types';

export interface PersistedPostInput extends NormalizedPostInput {
  contentHtml: string;
  wordCount: number;
  readingTimeMinutes: number;
}

export async function listAdminPosts(db: D1Database, filters: PostListFilters = {}): Promise<PostRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (!filters.includeDeleted) {
    conditions.push('deleted_at IS NULL');
  }

  if (filters.status) {
    conditions.push('status = ?');
    values.push(filters.status);
  }

  if (filters.visibility) {
    conditions.push('visibility = ?');
    values.push(filters.visibility);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const statement = db.prepare(
    `SELECT id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
        seo_title, seo_description, reading_time_minutes, word_count, published_at, created_at, updated_at, deleted_at
       FROM posts
       ${where}
       ORDER BY updated_at DESC
       LIMIT 100`
  );
  const result =
    values.length > 0 ? await statement.bind(...values).all<PostRow>() : await statement.all<PostRow>();

  return result.results ?? [];
}

export async function listPublicPosts(db: D1Database): Promise<PostRow[]> {
  const result = await db
    .prepare(
      `SELECT id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
        seo_title, seo_description, reading_time_minutes, word_count, published_at, created_at, updated_at, deleted_at
       FROM posts
       WHERE status = 'published'
         AND visibility = 'public'
         AND deleted_at IS NULL
         AND published_at IS NOT NULL
         AND published_at <= ?
       ORDER BY published_at DESC, updated_at DESC
       LIMIT 50`
    )
    .bind(nowIso())
    .all<PostRow>();

  return result.results ?? [];
}

export async function findPostById(db: D1Database, id: string): Promise<PostRow | null> {
  return db
    .prepare(
      `SELECT id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
        seo_title, seo_description, reading_time_minutes, word_count, published_at, created_at, updated_at, deleted_at
       FROM posts
       WHERE id = ?
       LIMIT 1`
    )
    .bind(id)
    .first<PostRow>();
}

export async function findPostBySlug(db: D1Database, slug: string): Promise<PostRow | null> {
  return db
    .prepare(
      `SELECT id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
        seo_title, seo_description, reading_time_minutes, word_count, published_at, created_at, updated_at, deleted_at
       FROM posts
       WHERE slug = ?
       LIMIT 1`
    )
    .bind(slug)
    .first<PostRow>();
}

export async function findPublicPostBySlug(db: D1Database, slug: string): Promise<PostRow | null> {
  return db
    .prepare(
      `SELECT id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
        seo_title, seo_description, reading_time_minutes, word_count, published_at, created_at, updated_at, deleted_at
       FROM posts
       WHERE slug = ?
         AND status = 'published'
         AND visibility = 'public'
         AND deleted_at IS NULL
         AND published_at IS NOT NULL
         AND published_at <= ?
       LIMIT 1`
    )
    .bind(slug, nowIso())
    .first<PostRow>();
}

export async function slugExists(db: D1Database, slug: string, excludeId?: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT id FROM posts WHERE slug = ? AND (? IS NULL OR id != ?) LIMIT 1`)
    .bind(slug, excludeId ?? null, excludeId ?? null)
    .first<{ id: string }>();

  return Boolean(row);
}

export async function createPost(db: D1Database, input: PersistedPostInput, slug: string): Promise<PostRow> {
  const now = nowIso();
  const status = input.status;
  const post: PostRow = {
    id: createRandomId('p'),
    slug,
    title: input.title,
    excerpt: input.excerpt,
    content_markdown: input.contentMarkdown,
    content_html: input.contentHtml,
    cover_asset_id: null,
    status,
    visibility: input.visibility,
    seo_title: input.seoTitle,
    seo_description: input.seoDescription,
    reading_time_minutes: input.readingTimeMinutes,
    word_count: input.wordCount,
    published_at: input.publishedAt ?? (status === 'published' ? now : null),
    created_at: now,
    updated_at: now,
    deleted_at: null
  };

  await db
    .prepare(
      `INSERT INTO posts (
        id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
        seo_title, seo_description, reading_time_minutes, word_count, published_at, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      post.id,
      post.slug,
      post.title,
      post.excerpt,
      post.content_markdown,
      post.content_html,
      post.cover_asset_id,
      post.status,
      post.visibility,
      post.seo_title,
      post.seo_description,
      post.reading_time_minutes,
      post.word_count,
      post.published_at,
      post.created_at,
      post.updated_at,
      post.deleted_at
    )
    .run();

  return post;
}

export async function updatePost(db: D1Database, id: string, input: PersistedPostInput): Promise<PostRow | null> {
  const current = await findPostById(db, id);

  if (!current || current.deleted_at) {
    return null;
  }

  const now = nowIso();
  const publishedAt = input.publishedAt ?? (input.status === 'published' ? (current.published_at ?? now) : current.published_at);

  await db
    .prepare(
      `UPDATE posts
       SET title = ?,
           excerpt = ?,
           content_markdown = ?,
           content_html = ?,
           status = ?,
           visibility = ?,
           seo_title = ?,
           seo_description = ?,
           reading_time_minutes = ?,
           word_count = ?,
           published_at = ?,
           updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`
    )
    .bind(
      input.title,
      input.excerpt,
      input.contentMarkdown,
      input.contentHtml,
      input.status,
      input.visibility,
      input.seoTitle,
      input.seoDescription,
      input.readingTimeMinutes,
      input.wordCount,
      publishedAt,
      now,
      id
    )
    .run();

  return findPostById(db, id);
}

export async function setPostStatus(db: D1Database, id: string, status: Exclude<PostStatus, 'deleted'>): Promise<PostRow | null> {
  const current = await findPostById(db, id);

  if (!current || current.deleted_at) {
    return null;
  }

  const now = nowIso();
  const publishedAt = status === 'published' ? (current.published_at ?? now) : current.published_at;

  await db
    .prepare(
      `UPDATE posts
       SET status = ?, published_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`
    )
    .bind(status, publishedAt, now, id)
    .run();

  return findPostById(db, id);
}

export async function replacePostAssets(db: D1Database, postId: string, assetIds: string[]): Promise<AssetRow[]> {
  const uniqueAssetIds = [...new Set(assetIds)];
  const now = nowIso();

  const existing = await db
    .prepare('SELECT asset_id FROM post_assets WHERE post_id = ?')
    .bind(postId)
    .all<{ asset_id: string }>();
  const affectedAssetIds = new Set<string>(existing.results?.map((row) => row.asset_id) ?? []);

  for (const assetId of uniqueAssetIds) {
    affectedAssetIds.add(assetId);
  }

  await db.prepare('DELETE FROM post_assets WHERE post_id = ?').bind(postId).run();

  for (const assetId of uniqueAssetIds) {
    await db
      .prepare(
        `INSERT INTO post_assets (post_id, asset_id, role, created_at)
         VALUES (?, ?, 'inline', ?)`
      )
      .bind(postId, assetId, now)
      .run();
  }

  return refreshAssetUsageCounts(db, [...affectedAssetIds]);
}

export async function listPostAssetIds(db: D1Database, postId: string): Promise<string[]> {
  const result = await db
    .prepare('SELECT asset_id FROM post_assets WHERE post_id = ?')
    .bind(postId)
    .all<{ asset_id: string }>();

  return result.results?.map((row) => row.asset_id) ?? [];
}

export async function clearPostAssets(db: D1Database, postId: string): Promise<AssetRow[]> {
  const assetIds = await listPostAssetIds(db, postId);
  await db.prepare('DELETE FROM post_assets WHERE post_id = ?').bind(postId).run();
  return refreshAssetUsageCounts(db, assetIds);
}

export async function softDeletePost(db: D1Database, id: string): Promise<PostRow | null> {
  const current = await findPostById(db, id);

  if (!current || current.deleted_at) {
    return null;
  }

  const now = nowIso();

  await db
    .prepare(
      `UPDATE posts
       SET status = 'deleted', deleted_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`
    )
    .bind(now, now, id)
    .run();

  return findPostById(db, id);
}
