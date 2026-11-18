import type { PostRow } from '@/lib/database.types';

export interface PublicCacheMetadata {
  postSlugs: string[];
  tagSlugs: string[];
  articlePageCount: number;
}

type CachePostRow = Pick<PostRow, 'slug' | 'status' | 'visibility' | 'published_at'>;

/** Read routing metadata only; cache invalidation must never load article bodies. */
export async function getPublicCacheMetadata(db: D1Database, now = new Date().toISOString()): Promise<PublicCacheMetadata> {
  const [posts, tags] = await Promise.all([
    db.prepare('SELECT slug, status, visibility, published_at FROM posts').all<CachePostRow>(),
    db.prepare('SELECT slug FROM tags').all<{ slug: string }>()
  ]);
  if (posts.success === false || tags.success === false) {
    throw new Error('Unable to read public cache routing metadata.');
  }
  const postRows = posts.results ?? [];
  const publicArticleCount = postRows.filter((post) =>
    post.slug !== 'about' && post.status === 'published' && post.visibility === 'public' &&
    post.published_at !== null && post.published_at <= now
  ).length;

  return {
    // Include no-longer-public posts and orphaned tags to evict their former public pages.
    postSlugs: postRows.map((post) => post.slug),
    tagSlugs: (tags.results ?? []).map((tag) => tag.slug),
    articlePageCount: Math.min(100, Math.max(1, Math.ceil(publicArticleCount / 5)))
  };
}
