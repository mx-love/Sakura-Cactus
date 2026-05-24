import type { APIRoute } from 'astro';
import { checkApprovedFriendLinksHealth } from '@/features/friends/friend.service';
import { getSiteSettings } from '@/features/settings/settings.service';
import { jsonError, jsonOk } from '@/lib/response';

export const prerender = false;

export const POST: APIRoute = async () => {
  try {
    const settings = await getSiteSettings();

    if (!settings.friendHealthEnabled) {
      return jsonError('FRIEND_HEALTH_DISABLED', 'Friend health monitoring is disabled.', { status: 403 });
    }

    const stats = await checkApprovedFriendLinksHealth();
    return jsonOk({ stats });
  } catch (error) {
    console.error('Friend health check failed:', error);
    return jsonError('FRIEND_HEALTH_CHECK_FAILED', 'Unable to check friend links.', { status: 500 });
  }
};
