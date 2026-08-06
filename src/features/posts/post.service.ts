import { getDb } from '@/lib/db';
import { reportError } from '@/lib/logging';
import { randomBytes } from '@/features/auth/crypto.service';
import { findAssetsByTokens, getMakeAssetsPublicStatements, refreshAssetUsageCounts } from '@/features/assets/asset.repo';
import { cleanupUnreferencedAssets, cleanupUnreferencedPostAssets } from '@/features/assets/asset.service';
import { getPostTagSyncStatements, getPostTags, preparePostTags } from '@/features/tags/tag.service';
import { calculateReadingTimeMinutes, calculateWordCount, decodeHtmlEntities, extractAssetTokens, renderMarkdown } from './post.renderer';
import {
  deletePostPermanently,
  findPostById,
  findPostBySlug,
  findAdjacentPublicPosts,
  findPublicPostBySlug,
  getPostAssetReplacementPlan,
  getMonthlyPublicPostStats,
  countPublicPosts,
  listPublicFeedPosts,
  listAdminPosts,
  listPublicPosts,
  listPublicSearchPosts,
  listPublicSitemapPosts,
  listAssetsForPost,
  prepareCreatePost,
  prepareUpdatePost,
  setPostPinnedAt,
  slugExists,
} from './post.repo';
import { normalizePostInput, PostValidationError } from './post.schema';
import type {
  MonthlyPostStats,
  MonthlyPostStatsRange,
  PostListFilters,
  PostRow,
  PublicPostDetail,
  PublicPostSummary,
  PublicPostTag
} from './post.types';
import { toPublicPostDetail, toPublicPostSummary } from './post.types';

export class PostConflictError extends Error {
  constructor(message = 'Slug already exists.') {
    super(message);
    this.name = 'PostConflictError';
  }
}

const RANDOM_SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const RANDOM_SLUG_LENGTH = 12;
const RANDOM_SLUG_MAX_ATTEMPTS = 20;
const ABOUT_SLUG = 'about';

function createRandomPostSlug(): string {
  const bytes = randomBytes(RANDOM_SLUG_LENGTH);
  let slug = '';

  for (const byte of bytes) {
    slug += RANDOM_SLUG_ALPHABET[byte % RANDOM_SLUG_ALPHABET.length];
  }

  return slug;
}

function buildPersistedInput(raw: unknown) {
  const input = normalizePostInput(raw);
  const contentHtml = renderMarkdown(input.contentMarkdown);

  return {
    ...input,
    contentHtml,
    wordCount: calculateWordCount(input.contentMarkdown),
    readingTimeMinutes: calculateReadingTimeMinutes(input.contentMarkdown)
  };
}

async function generateUniquePostSlug(db: D1Database): Promise<string> {
  for (let attempt = 0; attempt < RANDOM_SLUG_MAX_ATTEMPTS; attempt += 1) {
    const slug = createRandomPostSlug();

    if (!(await slugExists(db, slug))) {
      return slug;
    }
  }

  throw new PostConflictError('Unable to generate a unique post link.');
}

async function preparePostAssetIds(db: D1Database, markdown: string): Promise<string[]> {
  const tokens = extractAssetTokens(markdown);
  const assets = await findAssetsByTokens(db, tokens);
  const foundTokens = new Set(assets.map((asset) => asset.token));
  const missingTokens = tokens.filter((token) => !foundTokens.has(token));

  if (missingTokens.length > 0) {
    throw new PostValidationError('ASSET_NOT_FOUND', 'Some referenced images are no longer available.');
  }

  return assets.map((asset) => asset.id);
}

async function finalizePostSave(db: D1Database, affectedAssetIds: string[]): Promise<void> {
  if (affectedAssetIds.length === 0) {
    return;
  }

  const unusedAssets = await refreshAssetUsageCounts(db, affectedAssetIds);
  await cleanupUnreferencedAssets(db, unusedAssets);
}

function withCurrentContentHtml<T extends PostRow | null>(post: T): T {
  return post ? ({ ...post, content_html: renderMarkdown(post.content_markdown) } as T) : post;
}

async function attachPostTags<T extends PostRow | null>(db: D1Database, post: T): Promise<T> {
  if (!post) {
    return post;
  }

  return {
    ...withCurrentContentHtml(post),
    tags: await getPostTags(db, post.id)
  } as T;
}

async function getTagsForPostIds(db: D1Database, postIds: string[]): Promise<Map<string, PublicPostTag[]>> {
  const tagsByPostId = new Map<string, PublicPostTag[]>();
  const uniquePostIds = [...new Set(postIds)];

  if (uniquePostIds.length === 0) {
    return tagsByPostId;
  }

  for (let index = 0; index < uniquePostIds.length; index += 80) {
    const chunk = uniquePostIds.slice(index, index + 80);
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await db
      .prepare(
        `SELECT post_tags.post_id, tags.name, tags.slug
         FROM post_tags
         INNER JOIN tags ON tags.id = post_tags.tag_id
         WHERE post_tags.post_id IN (${placeholders})
         ORDER BY tags.name ASC`
      )
      .bind(...chunk)
      .all<{ post_id: string; name: string; slug: string }>();

    for (const row of result.results ?? []) {
      const tags = tagsByPostId.get(row.post_id) ?? [];
      tags.push({ name: row.name, slug: row.slug });
      tagsByPostId.set(row.post_id, tags);
    }
  }

  return tagsByPostId;
}

async function toPublicPostSummaries(db: D1Database, posts: PostRow[]): Promise<PublicPostSummary[]> {
  const tagsByPostId = await getTagsForPostIds(db, posts.map((post) => post.id));
  return posts.map((post) => toPublicPostSummary(post, tagsByPostId.get(post.id) ?? []));
}

export function isPostValidationError(error: unknown): error is PostValidationError {
  return error instanceof PostValidationError;
}

export function isPostConflictError(error: unknown): error is PostConflictError {
  return error instanceof PostConflictError;
}

export async function getAdminPosts(filters: PostListFilters = {}): Promise<PostRow[]> {
  return listAdminPosts(getDb(), filters);
}

export async function getAdminPost(id: string): Promise<PostRow | null> {
  const db = getDb();
  const post = await findPostById(db, id);
  return attachPostTags(db, post);
}

export async function getAdminPostBySlug(slug: string): Promise<PublicPostDetail | null> {
  const db = getDb();
  const post = await findPostBySlug(db, slug);
  return post ? toPublicPostDetail(post, await getPostTags(db, post.id)) : null;
}

export async function getAdminAboutPost(): Promise<PublicPostDetail | null> {
  return getAdminPostBySlug(ABOUT_SLUG);
}

export async function getAdminAboutEditorPost(): Promise<PostRow | null> {
  const db = getDb();
  const post = await findPostBySlug(db, ABOUT_SLUG);
  return attachPostTags(db, post);
}

export async function createAdminPost(raw: unknown): Promise<PostRow> {
  const db = getDb();
  const input = buildPersistedInput(raw);
  const slug = await generateUniquePostSlug(db);
  const assetIds = await preparePostAssetIds(db, input.contentMarkdown);
  const { tagIds } = await preparePostTags(db, input.tagNames);
  const { post, statement } = prepareCreatePost(db, input, slug);
  const assetPlan = await getPostAssetReplacementPlan(db, post.id, assetIds);

  await db.batch([
    statement,
    ...assetPlan.statements,
    ...getMakeAssetsPublicStatements(db, assetIds),
    ...getPostTagSyncStatements(db, post.id, tagIds)
  ]);
  await finalizePostSave(db, assetPlan.affectedAssetIds);
  return (await attachPostTags(db, await findPostById(db, post.id))) ?? post;
}

export async function saveAdminAboutPost(raw: unknown): Promise<PostRow> {
  const db = getDb();
  const input = buildPersistedInput(raw);
  const existing = await findPostBySlug(db, ABOUT_SLUG);
  const assetIds = await preparePostAssetIds(db, input.contentMarkdown);
  const { tagIds } = await preparePostTags(db, input.tagNames);
  const prepared = existing ? await prepareUpdatePost(db, existing.id, input) : prepareCreatePost(db, input, ABOUT_SLUG);

  if (!prepared) {
    throw new Error('Unable to save about page.');
  }

  const { post, statement } = prepared;
  const assetPlan = await getPostAssetReplacementPlan(db, post.id, assetIds);

  await db.batch([
    statement,
    ...assetPlan.statements,
    ...getMakeAssetsPublicStatements(db, assetIds),
    ...getPostTagSyncStatements(db, post.id, tagIds)
  ]);
  await finalizePostSave(db, assetPlan.affectedAssetIds);
  return (await attachPostTags(db, await findPostById(db, post.id))) ?? post;
}

export async function updateAdminPost(id: string, raw: unknown): Promise<PostRow | null> {
  const db = getDb();
  const input = buildPersistedInput(raw);
  const assetIds = await preparePostAssetIds(db, input.contentMarkdown);
  const { tagIds } = await preparePostTags(db, input.tagNames);
  const prepared = await prepareUpdatePost(db, id, input);

  if (prepared) {
    const { post, statement } = prepared;
    const assetPlan = await getPostAssetReplacementPlan(db, post.id, assetIds);

    await db.batch([
      statement,
      ...assetPlan.statements,
      ...getMakeAssetsPublicStatements(db, assetIds),
      ...getPostTagSyncStatements(db, post.id, tagIds)
    ]);
    await finalizePostSave(db, assetPlan.affectedAssetIds);
    return attachPostTags(db, await findPostById(db, post.id));
  }

  return null;
}

export async function pinAdminPost(id: string): Promise<PostRow | null> {
  return withCurrentContentHtml(await setPostPinnedAt(getDb(), id, new Date().toISOString()));
}

export async function unpinAdminPost(id: string): Promise<PostRow | null> {
  return withCurrentContentHtml(await setPostPinnedAt(getDb(), id, null));
}

export async function deleteAdminPost(id: string): Promise<PostRow | null> {
  const db = getDb();
  const assets = await listAssetsForPost(db, id);
  const post = await deletePostPermanently(db, id);

  if (post) {
    const assetIds = assets.map((asset) => asset.id);

    try {
      await refreshAssetUsageCounts(db, assetIds);
    } catch (error) {
      reportError('Post hard-delete asset usage refresh failed.', error, {
        postId: post.id,
        assetIds: assetIds.join(',')
      });
    }

    await cleanupUnreferencedPostAssets(db, post.id, assets);
  }

  return withCurrentContentHtml(post);
}

export async function getPublicPosts(options: {
  limit?: number;
  offset?: number;
  excludeAbout?: boolean;
  pinnedFirst?: boolean;
  tagSlug?: string;
} = {}): Promise<PublicPostSummary[]> {
  const db = getDb();
  const posts = await listPublicPosts(db, options);
  return toPublicPostSummaries(db, posts);
}

export async function getPublicMonthlyPostStats(range: MonthlyPostStatsRange): Promise<MonthlyPostStats> {
  return getMonthlyPublicPostStats(getDb(), range);
}

export async function getPublicPostsPage(page: number, pageSize: number): Promise<{ posts: PublicPostSummary[]; totalCount: number }> {
  const db = getDb();
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safePageSize = Math.min(Math.max(pageSize, 1), 50);
  const offset = (safePage - 1) * safePageSize;
  const options = {
    excludeAbout: true,
    pinnedFirst: true
  };
  const [posts, totalCount] = await Promise.all([
    listPublicPosts(db, { ...options, limit: safePageSize, offset }),
    countPublicPosts(db, options)
  ]);

  return {
    posts: await toPublicPostSummaries(db, posts),
    totalCount
  };
}

export async function getPublicFeedPosts(limit = 50) {
  return listPublicFeedPosts(getDb(), limit);
}

export async function getPublicSitemapPosts() {
  return listPublicSitemapPosts(getDb());
}

export async function getPublicSearchIndex(limit = 100) {
  const db = getDb();
  const posts = await listPublicSearchPosts(db, limit);
  const tagsByPostId = await getTagsForPostIds(db, posts.map((post) => post.id));

  return posts.map((post) => ({
    title: decodeHtmlEntities(post.title),
    slug: post.slug,
    excerpt: post.excerpt ? decodeHtmlEntities(post.excerpt) : '',
    published_at: post.published_at,
    tags: (tagsByPostId.get(post.id) ?? []).map((tag) => decodeHtmlEntities(tag.name))
  }));
}

export async function getAdjacentPublicPosts(post: PublicPostDetail) {
  const adjacent = await findAdjacentPublicPosts(getDb(), {
    id: post.id,
    published_at: post.publishedAt
  });

  return {
    previous: adjacent.previous
      ? {
          slug: adjacent.previous.slug,
          title: decodeHtmlEntities(adjacent.previous.title),
          publishedAt: adjacent.previous.published_at
        }
      : null,
    next: adjacent.next
      ? {
          slug: adjacent.next.slug,
          title: decodeHtmlEntities(adjacent.next.title),
          publishedAt: adjacent.next.published_at
        }
      : null
  };
}

export async function getPublicPostBySlug(slug: string): Promise<PublicPostDetail | null> {
  const db = getDb();
  const post = await findPublicPostBySlug(db, slug);
  return post ? toPublicPostDetail(post, await getPostTags(db, post.id)) : null;
}

export async function getPublicAboutPost(): Promise<PublicPostDetail | null> {
  return getPublicPostBySlug(ABOUT_SLUG);
}
