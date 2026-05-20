import type { APIRoute } from 'astro';
import { getCurrentAdminUser } from '@/features/auth/auth.service';
import { isAssetValidationError, uploadAdminAsset } from '@/features/assets/asset.service';
import { jsonError, jsonOk } from '@/lib/response';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const user = await getCurrentAdminUser(context);

  if (!user) {
    return jsonError('AUTH_REQUIRED', 'Authentication required.', { status: 401 });
  }

  let formData: FormData;

  try {
    formData = await context.request.formData();
  } catch {
    return jsonError('INVALID_FORM_DATA', 'Invalid upload request.', { status: 400 });
  }

  const file = formData.get('file');

  if (!(file instanceof File)) {
    return jsonError('FILE_REQUIRED', 'Image file is required.', { status: 400 });
  }

  try {
    const asset = await uploadAdminAsset(file, user);
    return jsonOk(
      {
        asset,
        url: `/i/${asset.token}`
      },
      { status: 201 }
    );
  } catch (error) {
    if (isAssetValidationError(error)) {
      return jsonError(error.code, error.message, { status: 400 });
    }

    console.error('Asset upload failed:', error);
    return jsonError('ASSET_UPLOAD_FAILED', 'Unable to upload image.', { status: 500 });
  }
};
