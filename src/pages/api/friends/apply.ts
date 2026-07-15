import type { APIRoute } from 'astro';
import { createFriendLinkApplication, isFriendLinkValidationError } from '@/features/friends/friend.service';
import { getSiteSettings } from '@/features/settings/settings.service';
import { jsonError, jsonOk } from '@/lib/response';
import { getSessionSecret } from '@/features/auth/auth.service';
import { consumeRateLimit } from '@/features/rate-limit/rate-limit.service';
import { getClientAddress } from '@/lib/security/request';
import { reportError } from '@/lib/logging';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const settings = await getSiteSettings();

  if (!settings.friendApplyEnabled) {
    return jsonError('FRIEND_APPLY_DISABLED', 'Friend link applications are not enabled.', { status: 403 });
  }

  const rateLimit = await consumeRateLimit({
    scope: 'friend_application',
    key: getClientAddress(request),
    secret: getSessionSecret(),
    limit: 5,
    windowSeconds: 60 * 60
  });

  if (!rateLimit.allowed) {
    return jsonError('RATE_LIMITED', 'Too many applications. Try again later.', {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(rateLimit.retryAfterSeconds)
      }
    });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError('INVALID_JSON', 'Invalid JSON payload.', { status: 400 });
  }

  try {
    const friend = await createFriendLinkApplication(body);
    return jsonOk({ friend }, { status: 201 });
  } catch (error) {
    if (isFriendLinkValidationError(error)) {
      return jsonError(error.code, error.message, { status: 400 });
    }

    reportError('Friend application failed.', error);
    return jsonError('FRIEND_APPLICATION_FAILED', 'Unable to submit friend link application.', { status: 500 });
  }
};
