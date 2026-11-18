import type { APIContext } from 'astro';
import { getPublicCacheMetadata, type PublicCacheMetadata } from '@/features/posts/post-cache.repo';
import { purgePublicCache, type PublicCacheScope } from './cache';
import { getDb } from './db';
import { reportError } from './logging';
import { getSiteOrigin } from './seo';

export type { PublicCacheMetadata } from '@/features/posts/post-cache.repo';

export async function capturePublicCacheState(): Promise<PublicCacheMetadata | undefined> {
  try {
    return await getPublicCacheMetadata(getDb());
  } catch (error) {
    reportError('Public cache metadata snapshot failed.', error);
    return undefined;
  }
}

function mergeSlugs(...groups: Array<readonly string[] | undefined>): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []))];
}

async function resolveScope(scope: PublicCacheScope, before?: PublicCacheMetadata): Promise<PublicCacheScope> {
  const needsArticleMetadata = scope.settings || scope.postSlugs?.length || scope.oldPostSlugs?.length ||
    scope.tagSlugs?.length || scope.articlePageCount !== undefined;
  if (!needsArticleMetadata) return scope;

  const after = await capturePublicCacheState();
  if (!before || !after) {
    console.warn('Public cache snapshot unavailable; using the bounded article-page purge fallback.');
  }

  // A personal blog's routing metadata is small. Evicting all article/tag keys also
  // covers both old and new neighbours when publication dates or slugs change.
  return {
    ...scope,
    postSlugs: mergeSlugs(after?.postSlugs, scope.postSlugs),
    oldPostSlugs: mergeSlugs(before?.postSlugs, scope.oldPostSlugs),
    tagSlugs: mergeSlugs(before?.tagSlugs, after?.tagSlugs, scope.tagSlugs),
    articlePageCount: before && after
      ? Math.min(100, Math.max(before.articlePageCount, after.articlePageCount, scope.articlePageCount ?? 1))
      : 100
  };
}

/** Best-effort invalidation, also usable from the Worker's scheduled task. */
export async function invalidatePublicCacheForOrigin(
  origin: string | undefined,
  scope: PublicCacheScope,
  before?: PublicCacheMetadata
): Promise<void> {
  try {
    const origins = new Set<string>();
    if (origin) origins.add(new URL(origin).origin);
    try {
      origins.add(getSiteOrigin());
    } catch (error) {
      // A missing/misconfigured canonical origin must not fail an already completed write.
      reportError('Canonical cache origin unavailable.', error);
    }
    if (!origins.size) return;

    const resolvedScope = await resolveScope(scope, before);
    for (const cacheOrigin of origins) {
      try {
        await purgePublicCache(cacheOrigin, resolvedScope);
      } catch (error) {
        reportError('Public cache invalidation failed.', error, { origin: cacheOrigin });
      }
    }
  } catch (error) {
    reportError('Public cache invalidation failed.', error);
  }
}

/** Schedule after a successful mutation; private response/cache policies stay unchanged. */
export async function invalidatePublicCache(
  context: Pick<APIContext, 'url' | 'locals'>,
  scope: PublicCacheScope,
  before?: PublicCacheMetadata
): Promise<void> {
  try {
    const task = invalidatePublicCacheForOrigin(context.url?.origin, scope, before);
    try {
      if (context.locals?.cfContext) {
        context.locals.cfContext.waitUntil(task);
        return;
      }
    } catch (error) {
      reportError('Public cache background scheduling failed.', error);
    }
    await task;
  } catch (error) {
    reportError('Public cache invalidation failed.', error);
  }
}
