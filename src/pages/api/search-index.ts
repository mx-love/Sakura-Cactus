import type { APIRoute } from 'astro';
import { getPublicSearchIndex } from '@/features/posts/post.service';

export const prerender = false;

export const GET: APIRoute = async () => {
  const posts = await getPublicSearchIndex(100);

  return Response.json(
    {
      ok: true,
      data: {
        posts
      }
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=300'
      }
    }
  );
};
