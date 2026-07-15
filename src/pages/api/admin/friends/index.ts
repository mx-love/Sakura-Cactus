import type { APIRoute } from 'astro';
import { jsonError, jsonOk } from '@/lib/response';
import {
  createAdminFriendLink,
  getAdminFriendLinks,
  isFriendLinkValidationError
} from '@/features/friends/friend.service';
import { reportError } from '@/lib/logging';

export const prerender = false;

export const GET: APIRoute = async () => {
  const friends = await getAdminFriendLinks();
  return jsonOk({ friends });
};

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError('INVALID_JSON', 'Invalid JSON payload.', { status: 400 });
  }

  try {
    const friend = await createAdminFriendLink(body);
    return jsonOk({ friend }, { status: 201 });
  } catch (error) {
    if (isFriendLinkValidationError(error)) {
      return jsonError(error.code, error.message, { status: 400 });
    }

    reportError('Create friend link failed.', error);
    return jsonError('FRIEND_CREATE_FAILED', 'Unable to create friend link.', { status: 500 });
  }
};
