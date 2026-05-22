import astroWorker from '@astrojs/cloudflare/entrypoints/server';
import { cleanupExpiredDraftAssets } from './features/assets/asset.service';

async function runScheduledAssetCleanup(cron: string): Promise<void> {
  const stats = await cleanupExpiredDraftAssets();
  console.info('Expired draft asset cleanup completed.', {
    cron,
    ...stats
  });
}

const worker: ExportedHandler<Env> = {
  fetch: astroWorker.fetch,
  scheduled(controller, _env, context) {
    context.waitUntil(runScheduledAssetCleanup(controller.cron));
  }
};

export default worker;
