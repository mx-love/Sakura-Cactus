import type { APIRoute } from 'astro';
import { getCurrentAdminUser } from '@/features/auth/auth.service';
import { getAssetForToken } from '@/features/assets/asset.service';

export const prerender = false;

const notFoundResponse = () =>
  new Response('Not found', {
    status: 404,
    headers: {
      'Cache-Control': 'no-store'
    }
  });

export const GET: APIRoute = async (context) => {
  const token = context.params.token?.trim();

  if (!token) {
    return notFoundResponse();
  }

  const user = await getCurrentAdminUser(context);
  const result = await getAssetForToken(token, user);

  if (!result) {
    return notFoundResponse();
  }

  const headers = new Headers();
  headers.set('Content-Type', result.asset.mime_type);
  headers.set(
    'Cache-Control',
    result.isPublic ? 'public, max-age=31536000, immutable' : 'private, no-store'
  );
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Disposition', 'inline');
  headers.set('Content-Length', String(result.object.size));
  headers.set('ETag', result.object.httpEtag);

  return new Response(result.object.body, {
    status: 200,
    headers
  });
};
