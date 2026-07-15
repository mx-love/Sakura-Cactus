import astroWorker from '@astrojs/cloudflare/entrypoints/server';
import { cleanupExpiredDraftAssets } from './features/assets/asset.service';
import { checkApprovedFriendLinksHealthIfEnabled } from './features/friends/friend.service';
import { getDb } from './lib/db';
import { ensureD1Schema } from './lib/schema';
import { cleanupStaleSessions } from './features/auth/session.repo';
import { reportError } from './lib/logging';

async function runScheduledTasks(cron: string): Promise<void> {
  const db = getDb();
  await ensureD1Schema(db);

  try {
    const stats = await cleanupExpiredDraftAssets();
    console.info('Expired draft asset cleanup completed.', { cron, ...stats });
  } catch (error) {
    reportError('Scheduled asset cleanup failed.', error);
  }

  try {
    const deletedSessions = await cleanupStaleSessions(db);
    console.info('Stale session cleanup completed.', { cron, deletedSessions });
  } catch (error) {
    reportError('Scheduled session cleanup failed.', error);
  }

  try {
    const friendStats = await checkApprovedFriendLinksHealthIfEnabled();

    if (friendStats) {
      console.info('Friend link health check completed.', { cron, ...friendStats });
    }
  } catch (error) {
    reportError('Scheduled friend health check failed.', error);
  }
}

const worker: ExportedHandler<Env> = {
  fetch: astroWorker.fetch,
  scheduled(controller, _env, context) {
    context.waitUntil(runScheduledTasks(controller.cron));
  }
};

export default worker;
