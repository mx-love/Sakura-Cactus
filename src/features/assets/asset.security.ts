export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/gif']);

const EXTENSIONS_BY_MIME: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif'
};

export class AssetValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'AssetValidationError';
  }
}

export function assertValidImageFile(file: File): void {
  if (file.size <= 0) {
    throw new AssetValidationError('EMPTY_FILE', 'File is empty.');
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new AssetValidationError('FILE_TOO_LARGE', 'Image must be 5 MB or smaller.');
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new AssetValidationError('INVALID_FILE_TYPE', 'Only webp, jpg, png, and gif images are allowed.');
  }
}

export function extensionForMimeType(mimeType: string): string {
  return EXTENSIONS_BY_MIME[mimeType] ?? 'bin';
}

export function isValidAssetToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{24,64}$/.test(token);
}
