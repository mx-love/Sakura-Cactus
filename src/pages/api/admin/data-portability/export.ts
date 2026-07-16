import type { APIRoute } from 'astro';
import { exportBlogData, isBlogDataError } from '@/features/data-portability/data-portability.service';
import { jsonError } from '@/lib/response';
import { reportError } from '@/lib/logging';

export const prerender = false;

export const POST: APIRoute = async ({ request, url }) => {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError('INVALID_JSON', 'Invalid JSON payload.', { status: 400 });
  }

  try {
    const result = await exportBlogData(body, url.origin);
    const responseBody = result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.byteLength) as ArrayBuffer;
    return new Response(responseBody, {
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    if (isBlogDataError(error)) {
      return jsonError(error.code, error.message, { status: error.status });
    }

    reportError('Blog data export failed.', error);
    return jsonError('DATA_EXPORT_FAILED', '无法导出博客数据。', { status: 500 });
  }
};
