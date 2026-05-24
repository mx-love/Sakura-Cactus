import astroWorker from '@astrojs/cloudflare/entrypoints/server';
import { cleanupExpiredDraftAssets } from './features/assets/asset.service';
import { checkApprovedFriendLinksHealthIfEnabled } from './features/friends/friend.service';
import { getDb } from './lib/db';
import { ensureD1Schema } from './lib/schema';

async function runScheduledAssetCleanup(cron: string): Promise<void> {
  await ensureD1Schema(getDb());

  const stats = await cleanupExpiredDraftAssets();
  console.info('Expired draft asset cleanup completed.', {
    cron,
    ...stats
  });

  const friendStats = await checkApprovedFriendLinksHealthIfEnabled();

  if (friendStats) {
    console.info('Friend link health check completed.', {
      cron,
      ...friendStats
    });
  }
}

const worker: ExportedHandler<Env> = {
  fetch: astroWorker.fetch,
  scheduled(controller, _env, context) {
    context.waitUntil(runScheduledAssetCleanup(controller.cron));
  }
};

export default worker;
