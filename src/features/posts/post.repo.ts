import { refreshAssetUsageCounts } from '@/features/assets/asset.repo';
import type { AssetRow, PostRow } from '@/lib/database.types';
import { nowIso } from '@/lib/db';
import { createRandomId } from '@/features/auth/crypto.service';
import type { NormalizedPostInput } from './post.schema';
import type { PostListFilters } from './post.types';

export interface PersistedPostInput extends NormalizedPostInput {
  contentHtml: string;
  wordCount: number;
  readingTimeMinutes: number;
}

export interface PublicPostQueryOptions {
  limit?: number;
  offset?: number;
  excludeAbout?: boolean;
  pinnedFirst?: boolean;
  tagSlug?: string;
}

export interface PublicPostFeedRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  published_at: string | null;
  updated_at: string;
}

export interface PublicPostSitemapRow {
  slug: string;
  published_at: string | null;
  updated_at: string;
}

export interface PublicSearchPostRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  published_at: string | null;
}

export interface AdjacentPublicPostRow {
  slug: string;
  title: string;
  published_at: string | null;
}

export interface PostCoverAssetProjection {
  cover_asset_token: string | null;
}

const POST_COLUMNS = `posts.id, posts.slug, posts.title, posts.excerpt, posts.content_markdown, posts.content_html,
  posts.cover_asset_id, posts.status, posts.visibility, posts.seo_title, posts.seo_description,
  posts.reading_time_minutes, posts.word_count, posts.published_at, posts.pinned_at, posts.created_at, posts.updated_at`;

const PUBLIC_POST_SUMMARY_SELECT = `SELECT posts.id, posts.slug, posts.title, posts.excerpt, posts.content_markdown,
  NULL AS content_html, posts.cover_asset_id, posts.status, posts.visibility, NULL AS seo_title,
  NULL AS seo_description, posts.reading_time_minutes, posts.word_count, posts.published_at,
  posts.pinned_at, posts.created_at, posts.updated_at,
  cover_assets.token AS cover_asset_token`;

const ASSET_COLUMNS = `assets.id, assets.token, assets.r2_key, assets.original_filename, assets.mime_type,
  assets.size_bytes, assets.width, assets.height, assets.sha256, assets.visibility, assets.usage_count,
  assets.created_by, assets.created_at, assets.updated_at, assets.deleted_at`;
const PUBLIC_COVER_JOIN = `LEFT JOIN assets cover_assets ON cover_assets.id = posts.cover_asset_id
  AND cover_assets.deleted_at IS NULL
  AND cover_assets.visibility != 'deleted'
  AND cover_assets.mime_type != 'image/svg+xml'`;

function publicPostWhere(options: PublicPostQueryOptions = {}): { joins: string[]; conditions: string[]; values: unknown[] } {
  const joins: string[] = [];
  const conditions = [
    "posts.status = 'published'",
    "posts.visibility = 'public'",
    'posts.published_at IS NOT NULL',
    'posts.published_at <= ?'
  ];
  const values: unknown[] = [nowIso()];

  if (options.excludeAbout) {
    conditions.push("posts.slug != 'about'");
  }

  if (options.tagSlug) {
    joins.push('INNER JOIN post_tags filter_post_tags ON filter_post_tags.post_id = posts.id');
    joins.push('INNER JOIN tags filter_tags ON filter_tags.id = filter_post_tags.tag_id');
    conditions.push('filter_tags.slug = ?');
    values.push(options.tagSlug);
  }

  return { joins, conditions, values };
}

function publicPostOrder(options: PublicPostQueryOptions = {}): string {
  if (options.pinnedFirst) {
    return 'ORDER BY posts.pinned_at IS NULL ASC, posts.pinned_at DESC, posts.published_at DESC, posts.updated_at DESC';
  }

  return 'ORDER BY posts.published_at DESC, posts.updated_at DESC';
}

export async function listAdminPosts(db: D1Database, filters: PostListFilters = {}): Promise<PostRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

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
    `SELECT ${POST_COLUMNS}
       FROM posts
       ${where}
       ORDER BY updated_at DESC
       LIMIT 100`
  );
  const result =
    values.length > 0 ? await statement.bind(...values).all<PostRow>() : await statement.all<PostRow>();

  return result.results ?? [];
}

export async function listPublicPosts(db: D1Database, options: PublicPostQueryOptions = {}): Promise<PostRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const { joins, conditions, values } = publicPostWhere(options);
  const result = await db
    .prepare(
      `${PUBLIC_POST_SUMMARY_SELECT}
       FROM posts
       ${PUBLIC_COVER_JOIN}
       ${joins.join('\n')}
       WHERE ${conditions.join(' AND ')}
       ${publicPostOrder(options)}
       LIMIT ? OFFSET ?`
    )
    .bind(...values, limit, offset)
    .all<PostRow>();

  return result.results ?? [];
}

export async function countPublicPosts(db: D1Database, options: PublicPostQueryOptions = {}): Promise<number> {
  const { joins, conditions, values } = publicPostWhere(options);
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT posts.id) AS count
       FROM posts
       ${joins.join('\n')}
       WHERE ${conditions.join(' AND ')}`
    )
    .bind(...values)
    .first<{ count: number }>();

  return row?.count ?? 0;
}

export async function listPublicFeedPosts(db: D1Database, limit = 50): Promise<PublicPostFeedRow[]> {
  const { conditions, values } = publicPostWhere({ excludeAbout: true });
  const result = await db
    .prepare(
      `SELECT posts.id, posts.slug, posts.title, posts.excerpt, posts.published_at, posts.updated_at
       FROM posts
       ${PUBLIC_COVER_JOIN}
       WHERE ${conditions.join(' AND ')}
       ORDER BY posts.published_at DESC, posts.updated_at DESC
       LIMIT ?`
    )
    .bind(...values, Math.min(Math.max(limit, 1), 100))
    .all<PublicPostFeedRow>();

  return result.results ?? [];
}

export async function listPublicSitemapPosts(db: D1Database): Promise<PublicPostSitemapRow[]> {
  const { conditions, values } = publicPostWhere({ excludeAbout: true });
  const result = await db
    .prepare(
      `SELECT posts.slug, posts.published_at, posts.updated_at
       FROM posts
       WHERE ${conditions.join(' AND ')}
       ORDER BY posts.published_at DESC, posts.updated_at DESC`
    )
    .bind(...values)
    .all<PublicPostSitemapRow>();

  return result.results ?? [];
}

export async function listPublicSearchPosts(db: D1Database, limit = 100): Promise<PublicSearchPostRow[]> {
  const { conditions, values } = publicPostWhere({ excludeAbout: true });
  const result = await db
    .prepare(
      `SELECT posts.id, posts.slug, posts.title, posts.excerpt, posts.published_at
       FROM posts
       WHERE ${conditions.join(' AND ')}
       ORDER BY posts.published_at DESC, posts.updated_at DESC
       LIMIT ?`
    )
    .bind(...values, Math.min(Math.max(limit, 1), 100))
    .all<PublicSearchPostRow>();

  return result.results ?? [];
}

export async function findAdjacentPublicPosts(
  db: D1Database,
  current: { id: string; published_at: string | null }
): Promise<{ previous: AdjacentPublicPostRow | null; next: AdjacentPublicPostRow | null }> {
  if (!current.published_at) {
    return { previous: null, next: null };
  }

  const base = publicPostWhere({ excludeAbout: true });
  const previous = await db
    .prepare(
      `SELECT posts.slug, posts.title, posts.published_at
       FROM posts
       WHERE ${base.conditions.join(' AND ')}
         AND posts.id != ?
         AND (
           posts.published_at < ?
           OR (posts.published_at = ? AND posts.id < ?)
         )
       ORDER BY posts.published_at DESC, posts.id DESC
       LIMIT 1`
    )
    .bind(...base.values, current.id, current.published_at, current.published_at, current.id)
    .first<AdjacentPublicPostRow>();

  const next = await db
    .prepare(
      `SELECT posts.slug, posts.title, posts.published_at
       FROM posts
       WHERE ${base.conditions.join(' AND ')}
         AND posts.id != ?
         AND (
           posts.published_at > ?
           OR (posts.published_at = ? AND posts.id > ?)
         )
       ORDER BY posts.published_at ASC, posts.id ASC
       LIMIT 1`
    )
    .bind(...base.values, current.id, current.published_at, current.published_at, current.id)
    .first<AdjacentPublicPostRow>();

  return {
    previous: previous ?? null,
    next: next ?? null
  };
}

export async function findPostById(db: D1Database, id: string): Promise<PostRow | null> {
  return db
    .prepare(
      `SELECT ${POST_COLUMNS}
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
      `SELECT ${POST_COLUMNS}, cover_assets.token AS cover_asset_token
       FROM posts
       ${PUBLIC_COVER_JOIN}
       WHERE posts.slug = ?
       LIMIT 1`
    )
    .bind(slug)
    .first<PostRow>();
}

export async function findPublicPostBySlug(db: D1Database, slug: string): Promise<PostRow | null> {
  return db
    .prepare(
      `SELECT ${POST_COLUMNS}, cover_assets.token AS cover_asset_token
       FROM posts
       ${PUBLIC_COVER_JOIN}
       WHERE posts.slug = ?
         AND posts.status = 'published'
         AND posts.visibility = 'public'
         AND posts.published_at IS NOT NULL
         AND posts.published_at <= ?
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
  const post: PostRow = {
    id: createRandomId('p'),
    slug,
    title: input.title,
    excerpt: input.excerpt,
    content_markdown: input.contentMarkdown,
    content_html: input.contentHtml,
    cover_asset_id: null,
    status: 'published',
    visibility: input.visibility,
    seo_title: input.seoTitle,
    seo_description: input.seoDescription,
    reading_time_minutes: input.readingTimeMinutes,
    word_count: input.wordCount,
    published_at: input.publishedAt ?? now,
    pinned_at: null,
    created_at: now,
    updated_at: now
  };

  await db
    .prepare(
      `INSERT INTO posts (
        id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
        seo_title, seo_description, reading_time_minutes, word_count, published_at, pinned_at, created_at, updated_at
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
      post.pinned_at,
      post.created_at,
      post.updated_at
    )
    .run();

  return post;
}

export function prepareCreatePost(db: D1Database, input: PersistedPostInput, slug: string): { post: PostRow; statement: D1PreparedStatement } {
  const now = nowIso();
  const post: PostRow = {
    id: createRandomId('p'),
    slug,
    title: input.title,
    excerpt: input.excerpt,
    content_markdown: input.contentMarkdown,
    content_html: input.contentHtml,
    cover_asset_id: null,
    status: 'published',
    visibility: input.visibility,
    seo_title: input.seoTitle,
    seo_description: input.seoDescription,
    reading_time_minutes: input.readingTimeMinutes,
    word_count: input.wordCount,
    published_at: input.publishedAt ?? now,
    pinned_at: null,
    created_at: now,
    updated_at: now
  };

  return {
    post,
    statement: db
      .prepare(
        `INSERT INTO posts (
          id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
          seo_title, seo_description, reading_time_minutes, word_count, published_at, pinned_at, created_at, updated_at
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
        post.pinned_at,
        post.created_at,
        post.updated_at
      )
  };
}

export async function updatePost(db: D1Database, id: string, input: PersistedPostInput): Promise<PostRow | null> {
  const current = await findPostById(db, id);

  if (!current) {
    return null;
  }

  const now = nowIso();
  const publishedAt = input.publishedAt ?? current.published_at ?? now;

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
       WHERE id = ?`
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

export async function prepareUpdatePost(db: D1Database, id: string, input: PersistedPostInput): Promise<{ post: PostRow; statement: D1PreparedStatement } | null> {
  const current = await findPostById(db, id);

  if (!current) {
    return null;
  }

  const now = nowIso();
  const publishedAt = input.publishedAt ?? current.published_at ?? now;
  const post: PostRow = {
    ...current,
    title: input.title,
    excerpt: input.excerpt,
    content_markdown: input.contentMarkdown,
    content_html: input.contentHtml,
    status: input.status,
    visibility: input.visibility,
    seo_title: input.seoTitle,
    seo_description: input.seoDescription,
    reading_time_minutes: input.readingTimeMinutes,
    word_count: input.wordCount,
    published_at: publishedAt,
    updated_at: now
  };

  return {
    post,
    statement: db
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
         WHERE id = ?`
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
  };
}

export async function setPostPinnedAt(db: D1Database, id: string, pinnedAt: string | null): Promise<PostRow | null> {
  const current = await findPostById(db, id);

  if (!current) {
    return null;
  }

  await db
    .prepare(
      `UPDATE posts
       SET pinned_at = ?
       WHERE id = ?`
    )
    .bind(pinnedAt, id)
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

  const statements = [db.prepare('DELETE FROM post_assets WHERE post_id = ?').bind(postId)];

  for (const assetId of uniqueAssetIds) {
    statements.push(
      db
        .prepare(
          `INSERT INTO post_assets (post_id, asset_id, role, created_at)
           VALUES (?, ?, 'inline', ?)`
        )
        .bind(postId, assetId, now)
    );
  }

  await db.batch(statements);

  return refreshAssetUsageCounts(db, [...affectedAssetIds]);
}

export async function getPostAssetReplacementPlan(db: D1Database, postId: string, assetIds: string[]): Promise<{ statements: D1PreparedStatement[]; affectedAssetIds: string[] }> {
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

  return {
    affectedAssetIds: [...affectedAssetIds],
    statements: [
      db.prepare('DELETE FROM post_assets WHERE post_id = ?').bind(postId),
      ...uniqueAssetIds.map((assetId) =>
        db
          .prepare(
            `INSERT INTO post_assets (post_id, asset_id, role, created_at)
             VALUES (?, ?, 'inline', ?)`
          )
          .bind(postId, assetId, now)
      )
    ]
  };
}

export async function listPostAssetIds(db: D1Database, postId: string): Promise<string[]> {
  const result = await db
    .prepare('SELECT asset_id FROM post_assets WHERE post_id = ?')
    .bind(postId)
    .all<{ asset_id: string }>();

  return result.results?.map((row) => row.asset_id) ?? [];
}

export async function listAssetsForPost(db: D1Database, postId: string): Promise<AssetRow[]> {
  const result = await db
    .prepare(
      `SELECT DISTINCT ${ASSET_COLUMNS}
       FROM assets
       WHERE assets.deleted_at IS NULL
         AND assets.id IN (
           SELECT asset_id FROM post_assets WHERE post_id = ?
           UNION
           SELECT cover_asset_id FROM posts WHERE id = ? AND cover_asset_id IS NOT NULL
         )`
    )
    .bind(postId, postId)
    .all<AssetRow>();

  return result.results ?? [];
}

export async function deletePostPermanently(db: D1Database, id: string): Promise<PostRow | null> {
  const current = await findPostById(db, id);

  if (!current) {
    return null;
  }

  const results = await db.batch([
    db.prepare('DELETE FROM post_tags WHERE post_id = ?').bind(id),
    db.prepare('DELETE FROM post_assets WHERE post_id = ?').bind(id),
    db.prepare('DELETE FROM post_view_counts WHERE post_id = ?').bind(id),
    db.prepare('DELETE FROM posts WHERE id = ?').bind(id)
  ]);
  const postDeleteChanges = results[3]?.meta?.changes;

  if (typeof postDeleteChanges !== 'number') {
    throw new Error('Post delete did not report an affected row count.');
  }

  if (postDeleteChanges === 0) {
    return null;
  }

  if (postDeleteChanges !== 1) {
    throw new Error('Post delete affected an unexpected number of rows.');
  }

  const remaining = await findPostById(db, id);

  if (remaining) {
    throw new Error('Post delete did not remove the database row.');
  }

  return current;
}
