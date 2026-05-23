import type { APIRoute } from 'astro';
import { pinAdminPost, unpinAdminPost } from '@/features/posts/post.service';
import { jsonError, jsonOk } from '@/lib/response';

export const prerender = false;

function getId(params: Record<string, string | undefined>): string | null {
  const id = params.id?.trim();
  return id && id.length > 0 ? id : null;
}

export const POST: APIRoute = async ({ params }) => {
  const id = getId(params);

  if (!id) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  const post = await pinAdminPost(id);

  if (!post) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  return jsonOk({ post });
};

export const DELETE: APIRoute = async ({ params }) => {
  const id = getId(params);

  if (!id) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  const post = await unpinAdminPost(id);

  if (!post) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  return jsonOk({ post });
};
