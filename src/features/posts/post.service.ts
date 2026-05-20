import { getDb } from '@/lib/db';
import { findAssetsByTokens, makeAssetsPublic } from '@/features/assets/asset.repo';
import { calculateReadingTimeMinutes, calculateWordCount, extractAssetTokens, renderMarkdown } from './post.renderer';
import {
  createPost,
  findPostById,
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

async function syncPostAssetReferences(db: D1Database, post: PostRow): Promise<void> {
  const tokens = extractAssetTokens(post.content_markdown);
  const assets = await findAssetsByTokens(db, tokens);
  const assetIds = assets.map((asset) => asset.id);

  await replacePostAssets(db, post.id, assetIds);

  if (post.status === 'published' && post.visibility === 'public') {
    await makeAssetsPublic(db, assetIds);
  }
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
  const post = await findPostById(getDb(), id);
  return post && !post.deleted_at ? post : null;
}

export async function createAdminPost(raw: unknown): Promise<PostRow> {
  const db = getDb();
  const input = buildPersistedInput(raw, 'draft');

  if (await slugExists(db, input.slug)) {
    throw new PostConflictError();
  }

  const post = await createPost(db, input);
  await syncPostAssetReferences(db, post);
  return (await findPostById(db, post.id)) ?? post;
}

export async function updateAdminPost(id: string, raw: unknown): Promise<PostRow | null> {
  const db = getDb();
  const input = buildPersistedInput(raw, 'draft');

  if (await slugExists(db, input.slug, id)) {
    throw new PostConflictError();
  }

  const post = await updatePost(db, id, input);

  if (post) {
    await syncPostAssetReferences(db, post);
    return findPostById(db, post.id);
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
  return softDeletePost(getDb(), id);
}

export async function getPublicPosts(): Promise<PublicPostSummary[]> {
  const posts = await listPublicPosts(getDb());
  return posts.map(toPublicPostSummary);
}

export async function getPublicPostBySlug(slug: string): Promise<PublicPostDetail | null> {
  const post = await findPublicPostBySlug(getDb(), slug);
  return post ? toPublicPostDetail(post) : null;
}
