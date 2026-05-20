import { getDb } from '@/lib/db';
import { calculateReadingTimeMinutes, calculateWordCount, renderMarkdown } from './post.renderer';
import {
  createPost,
  findPostById,
  findPublicPostBySlug,
  listAdminPosts,
  listPublicPosts,
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

  return createPost(db, input);
}

export async function updateAdminPost(id: string, raw: unknown): Promise<PostRow | null> {
  const db = getDb();
  const input = buildPersistedInput(raw, 'draft');

  if (await slugExists(db, input.slug, id)) {
    throw new PostConflictError();
  }

  return updatePost(db, id, input);
}

export async function publishAdminPost(id: string): Promise<PostRow | null> {
  return setPostStatus(getDb(), id, 'published');
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
