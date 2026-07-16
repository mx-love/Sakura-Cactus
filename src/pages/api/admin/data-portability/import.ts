import type { APIRoute } from 'astro';
import { importBlogDataFile, isBlogDataError } from '@/features/data-portability/data-portability.service';
import { jsonError, jsonOk } from '@/lib/response';
import { reportError } from '@/lib/logging';

export const prerender = false;

function readFile(formData: FormData): File | null {
  const file = formData.get('file');
  return file instanceof File ? file : null;
}

function readOptions(formData: FormData): unknown {
  const value = formData.get('options');

  if (typeof value !== 'string') {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
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
    const result = await importBlogDataFile(file, request, readOptions(formData));
    return jsonOk({ result });
  } catch (error) {
    if (isBlogDataError(error)) {
      return jsonError(error.code, error.message, { status: error.status });
    }

    reportError('Blog data import failed.', error);
    return jsonError('DATA_IMPORT_FAILED', '导入失败，未完成本次写入。', { status: 500 });
  }
};
