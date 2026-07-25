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

const MAX_DOWNLOAD_FILENAME_LENGTH = 120;
const UNSAFE_DOWNLOAD_FILENAME_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069/\\:"'<>|?*;]/g;

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

function truncateCodePoints(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join('');
}

function downloadFilenameStem(originalFilename: string | null): string {
  let value = (originalFilename ?? '')
    .normalize('NFKC')
    .replace(/[\uD800-\uDFFF]/g, '_')
    .replace(UNSAFE_DOWNLOAD_FILENAME_CHARS, '_')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .trim();
  const extensionIndex = value.lastIndexOf('.');

  if (extensionIndex > 0) {
    value = value.slice(0, extensionIndex);
  }

  return value.replace(/^[\s._-]+|[\s._-]+$/g, '') || 'image';
}

export function buildAssetDownloadFilename(originalFilename: string | null, mimeType: string): string {
  const extension = extensionForMimeType(mimeType.trim().toLowerCase());
  const maxStemLength = MAX_DOWNLOAD_FILENAME_LENGTH - extension.length - 1;
  const stem = truncateCodePoints(downloadFilenameStem(originalFilename), maxStemLength)
    .replace(/[\s._-]+$/g, '') || 'image';

  return `${stem}.${extension}`;
}

function buildAsciiDownloadFilename(filename: string): string {
  const extensionIndex = filename.lastIndexOf('.');
  const extension = extensionIndex >= 0 ? filename.slice(extensionIndex + 1) : 'bin';
  const stem = extensionIndex >= 0 ? filename.slice(0, extensionIndex) : filename;
  const maxStemLength = MAX_DOWNLOAD_FILENAME_LENGTH - extension.length - 1;
  const normalizedStem = stem
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');
  const asciiStem = truncateCodePoints(normalizedStem, maxStemLength).replace(/[._-]+$/g, '') || 'image';

  return `${asciiStem}.${extension}`;
}

function encodeRfc5987Value(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

export function buildAssetDownloadContentDisposition(originalFilename: string | null, mimeType: string): string {
  const filename = buildAssetDownloadFilename(originalFilename, mimeType);
  const asciiFilename = buildAsciiDownloadFilename(filename);

  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeRfc5987Value(filename)}`;
}

export function isValidAssetToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{24,64}$/.test(token);
}
