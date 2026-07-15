import type { APIRoute } from 'astro';
import { getCurrentAdminUser, getSessionSecret } from '@/features/auth/auth.service';
import { isAssetValidationError, uploadAdminAsset } from '@/features/assets/asset.service';
import { consumeRateLimit } from '@/features/rate-limit/rate-limit.service';
import { reportError } from '@/lib/logging';
import { jsonError, jsonOk } from '@/lib/response';
import { getClientAddress } from '@/lib/security/request';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const user = await getCurrentAdminUser(context);

  if (!user) {
    return jsonError('AUTH_REQUIRED', 'Authentication required.', { status: 401 });
  }

  const rateLimit = await consumeRateLimit({
    scope: 'admin_asset_upload',
    key: `${user.id}:${getClientAddress(context.request)}`,
    secret: getSessionSecret(),
    limit: 30,
    windowSeconds: 60 * 60
  });

  if (!rateLimit.allowed) {
    return jsonError('RATE_LIMITED', 'Too many uploads. Try again later.', {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(rateLimit.retryAfterSeconds)
      }
    });
  }

  let formData: FormData;

  try {
    formData = await context.request.formData();
  } catch {
    return jsonError('INVALID_FORM_DATA', 'Invalid upload request.', { status: 400 });
  }

  const files = formData.getAll('file');
  const file = files[0];

  if (files.length !== 1 || !(file instanceof File)) {
    return jsonError('FILE_REQUIRED', 'Image file is required.', { status: 400 });
  }

  try {
    const result = await uploadAdminAsset(file, user);
    return jsonOk(
      {
        asset: result.asset,
        url: `/i/${result.asset.token}`,
        created: result.created,
        reused: result.reused
      },
      { status: result.created ? 201 : 200 }
    );
  } catch (error) {
    if (isAssetValidationError(error)) {
      return jsonError(error.code, error.message, { status: error.code === 'FILE_TOO_LARGE' ? 413 : 400 });
    }

    reportError('Asset upload failed.', error);
    return jsonError('ASSET_UPLOAD_FAILED', 'Unable to upload image.', { status: 500 });
  }
};
