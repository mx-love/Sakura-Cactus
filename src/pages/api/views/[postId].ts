import type { APIRoute } from 'astro';
import { getSiteSettings, incrementPostViewCount } from '@/features/settings/settings.service';
import { jsonError, jsonOk } from '@/lib/response';
import { getSessionSecret } from '@/features/auth/auth.service';
import { consumeRateLimit } from '@/features/rate-limit/rate-limit.service';
import { getClientAddress } from '@/lib/security/request';

export const prerender = false;

function getPostId(params: Record<string, string | undefined>): string | null {
  const postId = params.postId?.trim();
  return postId && postId.length > 0 ? postId : null;
}

export const POST: APIRoute = async ({ params, request }) => {
  const postId = getPostId(params);

  if (!postId) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  const settings = await getSiteSettings();

  if (!settings.viewCountEnabled) {
    return jsonError('VIEW_COUNT_DISABLED', 'View counting is disabled.', { status: 403 });
  }

  const clientAddress = getClientAddress(request);
  const secret = getSessionSecret();
  const [clientLimit, postLimit] = await Promise.all([
    consumeRateLimit({
      scope: 'post_view_ip',
      key: clientAddress,
      secret,
      limit: 200,
      windowSeconds: 12 * 60 * 60
    }),
    consumeRateLimit({
      scope: 'post_view_post',
      key: `${clientAddress}:${postId}`,
      secret,
      limit: 1,
      windowSeconds: 12 * 60 * 60
    })
  ]);

  if (!clientLimit.allowed || !postLimit.allowed) {
    return jsonError('RATE_LIMITED', 'View has already been counted.', {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(Math.max(clientLimit.retryAfterSeconds, postLimit.retryAfterSeconds))
      }
    });
  }

  const count = await incrementPostViewCount(postId);

  if (count === null) {
    return jsonError('POST_NOT_FOUND', 'Post not found.', { status: 404 });
  }

  return jsonOk({ count });
};
