import { createRandomId } from '@/features/auth/crypto.service';
import { nowIso } from '@/lib/db';
import type { PostRow, TagRow } from '@/lib/database.types';

export interface PublicTagSummary extends TagRow {
  post_count: number;
}

const POST_SELECT = `SELECT posts.id, posts.slug, posts.title, posts.excerpt, posts.content_markdown,
  NULL AS content_html, posts.cover_asset_id, posts.status, posts.visibility, NULL AS seo_title,
  NULL AS seo_description, posts.reading_time_minutes, posts.word_count, posts.published_at,
  posts.pinned_at, posts.created_at, posts.updated_at,
  cover_assets.token AS cover_asset_token`;

export async function findTagByName(db: D1Database, name: string): Promise<TagRow | null> {
  return db
    .prepare('SELECT id, name, slug, color, created_at, updated_at FROM tags WHERE name = ? LIMIT 1')
    .bind(name)
    .first<TagRow>();
}

export async function findTagBySlug(db: D1Database, slug: string): Promise<TagRow | null> {
  return db
    .prepare('SELECT id, name, slug, color, created_at, updated_at FROM tags WHERE slug = ? LIMIT 1')
    .bind(slug)
    .first<TagRow>();
}

export async function tagSlugExists(db: D1Database, slug: string): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM tags WHERE slug = ? LIMIT 1').bind(slug).first<{ id: string }>();
  return Boolean(row);
}

export async function createTag(db: D1Database, name: string, slug: string): Promise<TagRow> {
  const now = nowIso();
  const tag: TagRow = {
    id: createRandomId('tag'),
    name,
    slug,
    color: null,
    created_at: now,
    updated_at: now
  };

  await db
    .prepare('INSERT INTO tags (id, name, slug, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(tag.id, tag.name, tag.slug, tag.color, tag.created_at, tag.updated_at)
    .run();

  return tag;
}

export async function replacePostTags(db: D1Database, postId: string, tagIds: string[]): Promise<void> {
  await db.batch(getPostTagReplacementStatements(db, postId, tagIds));
}

export function getPostTagReplacementStatements(db: D1Database, postId: string, tagIds: string[]): D1PreparedStatement[] {
  return [
    db.prepare('DELETE FROM post_tags WHERE post_id = ?').bind(postId),
    ...[...new Set(tagIds)].map((tagId) => db.prepare('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)').bind(postId, tagId))
  ];
}

export async function listTagsForPost(db: D1Database, postId: string): Promise<TagRow[]> {
  const result = await db
    .prepare(
      `SELECT tags.id, tags.name, tags.slug, tags.color, tags.created_at, tags.updated_at
       FROM tags
       INNER JOIN post_tags ON post_tags.tag_id = tags.id
       WHERE post_tags.post_id = ?
       ORDER BY tags.name ASC`
    )
    .bind(postId)
    .all<TagRow>();

  return result.results ?? [];
}

export async function listPublicTags(db: D1Database, now: string): Promise<PublicTagSummary[]> {
  const result = await db
    .prepare(
      `SELECT tags.id, tags.name, tags.slug, tags.color, tags.created_at, tags.updated_at,
        COUNT(posts.id) AS post_count
       FROM tags
       INNER JOIN post_tags ON post_tags.tag_id = tags.id
       INNER JOIN posts ON posts.id = post_tags.post_id
       WHERE posts.status = 'published'
         AND posts.visibility = 'public'
         AND posts.published_at IS NOT NULL
         AND posts.published_at <= ?
         AND posts.slug != 'about'
       GROUP BY tags.id
       ORDER BY tags.name ASC`
    )
    .bind(now)
    .all<PublicTagSummary>();

  return result.results ?? [];
}

export async function listPublicPostsByTagSlug(db: D1Database, slug: string, now: string): Promise<PostRow[]> {
  const result = await db
    .prepare(
      `${POST_SELECT}
       FROM posts
       LEFT JOIN assets cover_assets ON cover_assets.id = posts.cover_asset_id
         AND cover_assets.deleted_at IS NULL
         AND cover_assets.visibility != 'deleted'
         AND cover_assets.mime_type != 'image/svg+xml'
       INNER JOIN post_tags ON post_tags.post_id = posts.id
       INNER JOIN tags ON tags.id = post_tags.tag_id
       WHERE tags.slug = ?
         AND posts.status = 'published'
         AND posts.visibility = 'public'
         AND posts.published_at IS NOT NULL
         AND posts.published_at <= ?
         AND posts.slug != 'about'
       ORDER BY posts.published_at DESC, posts.updated_at DESC
       LIMIT 50`
    )
    .bind(slug, now)
    .all<PostRow>();

  return result.results ?? [];
}
