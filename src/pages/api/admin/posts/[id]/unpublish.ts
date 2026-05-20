import type { APIRoute } from 'astro';
import { unpublishAdminPost } from '@/features/posts/post.service';
import { jsonError, jsonOk } from '@/lib/response';

export const prerender = false;

export const POST: APIRoute = async ({ params }) => {
  const id = params.id?.trim();

  if (!id) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  const post = await unpublishAdminPost(id);

  if (!post) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  return jsonOk({ post });
};
