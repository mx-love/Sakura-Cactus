import type { APIRoute } from 'astro';
import { getSiteSettings, incrementPostViewCount } from '@/features/settings/settings.service';
import { jsonError, jsonOk } from '@/lib/response';

export const prerender = false;

function getPostId(params: Record<string, string | undefined>): string | null {
  const postId = params.postId?.trim();
  return postId && postId.length > 0 ? postId : null;
}

export const POST: APIRoute = async ({ params }) => {
  const postId = getPostId(params);

  if (!postId) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  const settings = await getSiteSettings();

  if (!settings.viewCountEnabled) {
    return jsonError('VIEW_COUNT_DISABLED', 'View counting is disabled.', { status: 403 });
  }

  const count = await incrementPostViewCount(postId);

  if (count === null) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  return jsonOk({ count });
};
