import type { APIRoute } from 'astro';
import { inspectBlogDataFile, isBlogDataError } from '@/features/data-portability/data-portability.service';
import { jsonError, jsonOk } from '@/lib/response';
import { reportError } from '@/lib/logging';

export const prerender = false;

function readFile(formData: FormData): File | null {
  const file = formData.get('file');
  return file instanceof File ? file : null;
}

export const POST: APIRoute = async ({ request }) => {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return jsonError('INVALID_FORM', '文件不完整、已损坏或格式不受支持。', { status: 400 });
  }

  const file = readFile(formData);

  if (!file) {
    return jsonError('FILE_REQUIRED', '请选择导入文件。', { status: 400 });
  }

  try {
    const result = await inspectBlogDataFile(file, request);
    return jsonOk({ inspect: result });
  } catch (error) {
    if (isBlogDataError(error)) {
      return jsonError(error.code, error.message, { status: error.status });
    }

    reportError('Blog data inspect failed.', error);
    return jsonError('DATA_INSPECT_FAILED', '文件不完整、已损坏或格式不受支持。', { status: 400 });
  }
};
