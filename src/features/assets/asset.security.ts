export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/gif']);

const EXTENSIONS_BY_MIME: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif'
};

const ALLOWED_EXTENSIONS_BY_MIME: Record<string, Set<string>> = {
  'image/webp': new Set(['webp']),
  'image/jpeg': new Set(['jpg', 'jpeg']),
  'image/png': new Set(['png']),
  'image/gif': new Set(['gif'])
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

  const normalizedName = file.name.trim().toLowerCase();
  const extension = normalizedName.includes('.') ? normalizedName.split('.').pop() ?? '' : '';

  if (extension && !ALLOWED_EXTENSIONS_BY_MIME[file.type]?.has(extension)) {
    throw new AssetValidationError('INVALID_FILE_EXTENSION', 'File extension does not match the image type.');
  }
}

export function assertValidImageBytes(bytes: Uint8Array, mimeType: string): void {
  const matches = (() => {
    if (mimeType === 'image/jpeg') {
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    }

    if (mimeType === 'image/png') {
      const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
    }

    if (mimeType === 'image/gif') {
      const header = String.fromCharCode(...bytes.subarray(0, 6));
      return header === 'GIF87a' || header === 'GIF89a';
    }

    if (mimeType === 'image/webp') {
      return bytes.length >= 12 &&
        String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
        String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
    }

    return false;
  })();

  if (!matches) {
    throw new AssetValidationError('INVALID_FILE_SIGNATURE', 'File content does not match the declared image type.');
  }
}

export function sanitizeOriginalFilename(value: string): string | null {
  const filename = value
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 200);

  return filename || null;
}

export function extensionForMimeType(mimeType: string): string {
  return EXTENSIONS_BY_MIME[mimeType] ?? 'bin';
}

export function isValidAssetToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{24,64}$/.test(token);
}
