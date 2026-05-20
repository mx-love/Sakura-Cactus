import type { APIRoute } from 'astro';
import { jsonError, jsonOk } from '@/lib/response';
import { isAssetStorageError } from '@/features/assets/asset.service';
import {
  deleteAdminPost,
  getAdminPost,
  isPostConflictError,
  isPostValidationError,
  updateAdminPost
} from '@/features/posts/post.service';

export const prerender = false;

function getId(params: Record<string, string | undefined>): string | null {
  const id = params.id?.trim();
  return id && id.length > 0 ? id : null;
}

export const GET: APIRoute = async ({ params }) => {
  const id = getId(params);

  if (!id) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  const post = await getAdminPost(id);

  if (!post) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  return jsonOk({ post });
};

export const PUT: APIRoute = async ({ params, request }) => {
  const id = getId(params);

  if (!id) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError('INVALID_JSON', 'Invalid JSON payload.', { status: 400 });
  }

  try {
    const post = await updateAdminPost(id, body);

    if (!post) {
      return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
    }

    return jsonOk({ post });
  } catch (error) {
    if (isPostValidationError(error)) {
      return jsonError(error.code, error.message, { status: 400 });
    }

    if (isPostConflictError(error)) {
      return jsonError('SLUG_CONFLICT', error.message, { status: 409 });
    }

    if (isAssetStorageError(error)) {
      return jsonError(error.code, error.message, { status: 502 });
    }

    console.error('Update post failed:', error);
    return jsonError('POST_UPDATE_FAILED', 'Unable to update post.', { status: 500 });
  }
};

export const DELETE: APIRoute = async ({ params }) => {
  const id = getId(params);

  if (!id) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  try {
    const post = await deleteAdminPost(id);

    if (!post) {
      return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
    }

    return jsonOk({ post });
  } catch (error) {
    if (isAssetStorageError(error)) {
      return jsonError(error.code, error.message, { status: 502 });
    }

    console.error('Delete post failed:', error);
    return jsonError('POST_DELETE_FAILED', 'Unable to delete post.', { status: 500 });
  }
};
