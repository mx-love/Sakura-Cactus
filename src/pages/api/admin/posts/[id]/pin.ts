import type { APIRoute } from 'astro';
import { pinAdminPost, unpinAdminPost } from '@/features/posts/post.service';
import { jsonError, jsonOk } from '@/lib/response';
import { capturePublicCacheState, invalidatePublicCache } from '@/lib/public-cache-invalidation';

export const prerender = false;

function getId(params: Record<string, string | undefined>): string | null {
  const id = params.id?.trim();
  return id && id.length > 0 ? id : null;
}

export const POST: APIRoute = async (context) => {
  const { params } = context;
  const id = getId(params);

  if (!id) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  const cacheBefore = await capturePublicCacheState();
  const post = await pinAdminPost(id);

  if (!post) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  await invalidatePublicCache(context, { postSlugs: [post.slug] }, cacheBefore);
  return jsonOk({ post });
};

export const DELETE: APIRoute = async (context) => {
  const { params } = context;
  const id = getId(params);

  if (!id) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  const cacheBefore = await capturePublicCacheState();
  const post = await unpinAdminPost(id);

  if (!post) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  await invalidatePublicCache(context, { postSlugs: [post.slug] }, cacheBefore);
  return jsonOk({ post });
};
