import type { APIRoute } from 'astro';
import { jsonError, jsonOk } from '@/lib/response';
import {
  deleteAdminFriendLink,
  isFriendLinkValidationError,
  updateAdminFriendLink
} from '@/features/friends/friend.service';
import { reportError } from '@/lib/logging';
import { invalidatePublicCache } from '@/lib/public-cache-invalidation';

export const prerender = false;

function getId(params: Record<string, string | undefined>): string | null {
  const id = params.id?.trim();
  return id && id.length > 0 ? id : null;
}

export const PATCH: APIRoute = async (context) => {
  const { params, request } = context;
  const id = getId(params);

  if (!id) {
    return jsonError('FRIEND_NOT_FOUND', 'Friend link not found.', { status: 404 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError('INVALID_JSON', 'Invalid JSON payload.', { status: 400 });
  }

  try {
    const friend = await updateAdminFriendLink(id, body);

    if (!friend) {
      return jsonError('FRIEND_NOT_FOUND', 'Friend link not found.', { status: 404 });
    }

    await invalidatePublicCache(context, { friends: true });
    return jsonOk({ friend });
  } catch (error) {
    if (isFriendLinkValidationError(error)) {
      return jsonError(error.code, error.message, { status: 400 });
    }

    reportError('Update friend link failed.', error);
    return jsonError('FRIEND_UPDATE_FAILED', 'Unable to update friend link.', { status: 500 });
  }
};

export const DELETE: APIRoute = async (context) => {
  const { params } = context;
  const id = getId(params);

  if (!id) {
    return jsonError('FRIEND_NOT_FOUND', 'Friend link not found.', { status: 404 });
  }

  const friend = await deleteAdminFriendLink(id);

  if (!friend) {
    return jsonError('FRIEND_NOT_FOUND', 'Friend link not found.', { status: 404 });
  }

  await invalidatePublicCache(context, { friends: true });
  return jsonOk({ friend });
};
