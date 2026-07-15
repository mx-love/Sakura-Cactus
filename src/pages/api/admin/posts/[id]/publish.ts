import type { APIRoute } from 'astro';
import { isPostValidationError, publishAdminPost } from '@/features/posts/post.service';
import { jsonError, jsonOk } from '@/lib/response';

export const prerender = false;

export const POST: APIRoute = async ({ params }) => {
  const id = params.id?.trim();

  if (!id) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  let post: Awaited<ReturnType<typeof publishAdminPost>>;

  try {
    post = await publishAdminPost(id);
  } catch (error) {
    if (isPostValidationError(error)) {
      return jsonError(error.code, error.message, { status: 400 });
    }

    throw error;
  }

  if (!post) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  return jsonOk({ post });
};
