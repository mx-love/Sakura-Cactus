import type { APIRoute } from 'astro';
import { jsonError, jsonOk } from '@/lib/response';
import {
  createAdminPost,
  getAdminPosts,
  isPostConflictError,
  isPostValidationError,
  saveAdminAboutPost
} from '@/features/posts/post.service';
import type { PostStatus, PostVisibility } from '@/features/posts/post.types';
import { POST_STATUSES, POST_VISIBILITIES } from '@/features/posts/post.schema';
import { reportError } from '@/lib/logging';

export const prerender = false;

function parseStatus(value: string | null): PostStatus | undefined {
  return value && POST_STATUSES.includes(value as PostStatus) ? (value as PostStatus) : undefined;
}

function parseVisibility(value: string | null): PostVisibility | undefined {
  return value && POST_VISIBILITIES.includes(value as PostVisibility) ? (value as PostVisibility) : undefined;
}

export const GET: APIRoute = async ({ url }) => {
  const posts = await getAdminPosts({
    status: parseStatus(url.searchParams.get('status')),
    visibility: parseVisibility(url.searchParams.get('visibility'))
  });

  return jsonOk({ posts });
};

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError('INVALID_JSON', 'Invalid JSON payload.', { status: 400 });
  }

  try {
    const isAboutPost = Boolean(body && typeof body === 'object' && (body as Record<string, unknown>).type === 'about');
    const post = isAboutPost ? await saveAdminAboutPost(body) : await createAdminPost(body);
    return jsonOk({ post }, { status: 201 });
  } catch (error) {
    if (isPostValidationError(error)) {
      return jsonError(error.code, error.message, { status: 400 });
    }

    if (isPostConflictError(error)) {
      return jsonError('SLUG_CONFLICT', error.message, { status: 409 });
    }

    reportError('Create post failed.', error);
    return jsonError('POST_CREATE_FAILED', 'Unable to create post.', { status: 500 });
  }
};
