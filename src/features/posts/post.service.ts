import { getDb } from '@/lib/db';
import { randomBytes } from '@/features/auth/crypto.service';
import { findAssetsByTokens, makeAssetsPublic } from '@/features/assets/asset.repo';
import { cleanupUnreferencedAssets } from '@/features/assets/asset.service';
import { getPostTags, syncPostTags } from '@/features/tags/tag.service';
import { calculateReadingTimeMinutes, calculateWordCount, extractAssetTokens, renderMarkdown } from './post.renderer';
import {
  createPost,
  clearPostAssets,
  findPostById,
  findPostBySlug,
  findPublicPostBySlug,
  listAdminPosts,
  listPublicPosts,
  replacePostAssets,
  setPostStatus,
  slugExists,
  softDeletePost,
  updatePost
} from './post.repo';
import { normalizePostInput, PostValidationError } from './post.schema';
import type { PostListFilters, PostRow, PublicPostDetail, PublicPostSummary } from './post.types';
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

function createRandomPostSlug(): string {
  const bytes = randomBytes(RANDOM_SLUG_LENGTH);
  let slug = '';

  for (const byte of bytes) {
    slug += RANDOM_SLUG_ALPHABET[byte % RANDOM_SLUG_ALPHABET.length];
  }

  return slug;
}

function buildPersistedInput(raw: unknown, defaultStatus: 'draft' | 'published' | 'archived') {
  const input = normalizePostInput(raw, defaultStatus);
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

async function syncPostAssetReferences(db: D1Database, post: PostRow): Promise<void> {
  const tokens = extractAssetTokens(post.content_markdown);
  const assets = await findAssetsByTokens(db, tokens);
  const assetIds = assets.map((asset) => asset.id);

  const unusedAssets = await replacePostAssets(db, post.id, assetIds);

  if (post.status === 'published' && post.visibility === 'public') {
    await makeAssetsPublic(db, assetIds);
  }

  await cleanupUnreferencedAssets(db, unusedAssets);
}

async function attachPostTags<T extends PostRow | null>(db: D1Database, post: T): Promise<T> {
  if (!post) {
    return post;
  }

  return {
    ...post,
    tags: await getPostTags(db, post.id)
  } as T;
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
  return post && !post.deleted_at ? attachPostTags(db, post) : null;
}

export async function getAdminPostBySlug(slug: string): Promise<PublicPostDetail | null> {
  const db = getDb();
  const post = await findPostBySlug(db, slug);
  return post && !post.deleted_at ? toPublicPostDetail(post, await getPostTags(db, post.id)) : null;
}

export async function createAdminPost(raw: unknown): Promise<PostRow> {
  const db = getDb();
  const input = buildPersistedInput(raw, 'draft');
  const slug = await generateUniquePostSlug(db);

  const post = await createPost(db, input, slug);
  await syncPostAssetReferences(db, post);
  await syncPostTags(db, post.id, input.tagNames);
  return (await attachPostTags(db, await findPostById(db, post.id))) ?? post;
}

export async function updateAdminPost(id: string, raw: unknown): Promise<PostRow | null> {
  const db = getDb();
  const input = buildPersistedInput(raw, 'draft');

  const post = await updatePost(db, id, input);

  if (post) {
    await syncPostAssetReferences(db, post);
    await syncPostTags(db, post.id, input.tagNames);
    return attachPostTags(db, await findPostById(db, post.id));
  }

  return null;
}

export async function publishAdminPost(id: string): Promise<PostRow | null> {
  const db = getDb();
  const post = await setPostStatus(db, id, 'published');

  if (post) {
    await syncPostAssetReferences(db, post);
    return findPostById(db, post.id);
  }

  return null;
}

export async function unpublishAdminPost(id: string): Promise<PostRow | null> {
  return setPostStatus(getDb(), id, 'archived');
}

export async function deleteAdminPost(id: string): Promise<PostRow | null> {
  const db = getDb();
  const post = await softDeletePost(db, id);

  if (post) {
    const unusedAssets = await clearPostAssets(db, id);
    await cleanupUnreferencedAssets(db, unusedAssets);
  }

  return post;
}

export async function getPublicPosts(): Promise<PublicPostSummary[]> {
  const db = getDb();
  const posts = await listPublicPosts(db);
  const summaries: PublicPostSummary[] = [];

  for (const post of posts) {
    summaries.push(toPublicPostSummary(post, await getPostTags(db, post.id)));
  }

  return summaries;
}

export async function getPublicPostBySlug(slug: string): Promise<PublicPostDetail | null> {
  const db = getDb();
  const post = await findPublicPostBySlug(db, slug);
  return post ? toPublicPostDetail(post, await getPostTags(db, post.id)) : null;
}
