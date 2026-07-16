import { DATA_PORTABILITY_LIMITS, DATA_PORTABILITY_TEXT } from './data-portability.constants';

export class DataZipError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'DataZipError';
  }
}

export interface ZipInputFile {
  path: string;
  bytes: Uint8Array;
}

export interface ParsedZipFile {
  path: string;
  bytes: Uint8Array;
  compressedSize: number;
  uncompressedSize: number;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const crcTable = createCrcTable();

function createCrcTable(): number[] {
  const table: number[] = [];

  for (let i = 0; i < 256; i += 1) {
    let value = i;

    for (let j = 0; j < 8; j += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table.push(value >>> 0);
  }

  return table;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function uint16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, value, true);
  return bytes;
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, value >>> 0, true);
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }

  return output;
}

export function assertSafeZipPath(path: string): void {
  if (
    !path ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    path.includes('\\') ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..') ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new DataZipError('ZIP_PATH_INVALID', DATA_PORTABILITY_TEXT.zipStructureInvalid);
  }
}

export function createDataZip(files: ZipInputFile[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    assertSafeZipPath(file.path);
    const filename = textEncoder.encode(file.path);
    const checksum = crc32(file.bytes);
    const localHeader = concat([
      uint32(0x04034b50),
      uint16(20),
      uint16(0x0800),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(checksum),
      uint32(file.bytes.byteLength),
      uint32(file.bytes.byteLength),
      uint16(filename.byteLength),
      uint16(0),
      filename
    ]);

    localParts.push(localHeader, file.bytes);
    centralParts.push(
      concat([
        uint32(0x02014b50),
        uint16(20),
        uint16(20),
        uint16(0x0800),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(checksum),
        uint32(file.bytes.byteLength),
        uint32(file.bytes.byteLength),
        uint16(filename.byteLength),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(offset),
        filename
      ])
    );
    offset += localHeader.byteLength + file.bytes.byteLength;
  }

  const centralDirectory = concat(centralParts);
  const endOfCentralDirectory = concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(files.length),
    uint16(files.length),
    uint32(centralDirectory.byteLength),
    uint32(offset),
    uint16(0)
  ]);

  return concat([...localParts, centralDirectory, endOfCentralDirectory]);
}

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minOffset = Math.max(0, bytes.byteLength - 65_557);

  for (let offset = bytes.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }

  throw new DataZipError('ZIP_STRUCTURE_INVALID', DATA_PORTABILITY_TEXT.zipStructureInvalid);
}

export function parseDataZip(input: ArrayBuffer): ParsedZipFile[] {
  const bytes = new Uint8Array(input);

  if (bytes.byteLength > DATA_PORTABILITY_LIMITS.zipFileBytes) {
    throw new DataZipError('FILE_TOO_LARGE', DATA_PORTABILITY_TEXT.fileTooLarge);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const entryCount = readUint16(view, eocdOffset + 10);
  const centralSize = readUint32(view, eocdOffset + 12);
  const centralOffset = readUint32(view, eocdOffset + 16);

  if (centralOffset + centralSize > bytes.byteLength) {
    throw new DataZipError('ZIP_STRUCTURE_INVALID', DATA_PORTABILITY_TEXT.zipStructureInvalid);
  }

  const files: ParsedZipFile[] = [];
  const seenPaths = new Set<string>();
  let offset = centralOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(view, offset) !== 0x02014b50) {
      throw new DataZipError('ZIP_STRUCTURE_INVALID', DATA_PORTABILITY_TEXT.zipStructureInvalid);
    }

    const method = readUint16(view, offset + 10);
    const compressedSize = readUint32(view, offset + 20);
    const uncompressedSize = readUint32(view, offset + 24);
    const filenameLength = readUint16(view, offset + 28);
    const extraLength = readUint16(view, offset + 30);
    const commentLength = readUint16(view, offset + 32);
    const localOffset = readUint32(view, offset + 42);
    const path = textDecoder.decode(bytes.subarray(offset + 46, offset + 46 + filenameLength));

    assertSafeZipPath(path);

    if (seenPaths.has(path)) {
      throw new DataZipError('ZIP_DUPLICATE_FILE', DATA_PORTABILITY_TEXT.zipStructureInvalid);
    }

    seenPaths.add(path);

    if (uncompressedSize > DATA_PORTABILITY_LIMITS.mediaFileBytes && path.startsWith('media/')) {
      throw new DataZipError('MEDIA_TOO_LARGE', DATA_PORTABILITY_TEXT.mediaTooLarge);
    }

    totalUncompressed += uncompressedSize;

    if (totalUncompressed > DATA_PORTABILITY_LIMITS.zipUncompressedBytes) {
      throw new DataZipError('ZIP_TOO_LARGE', DATA_PORTABILITY_TEXT.fileTooLarge);
    }

    if (compressedSize > 0 && uncompressedSize / compressedSize > DATA_PORTABILITY_LIMITS.zipCompressionRatio) {
      throw new DataZipError('ZIP_COMPRESSION_RATIO', DATA_PORTABILITY_TEXT.zipStructureInvalid);
    }

    if (method !== 0) {
      throw new DataZipError('ZIP_COMPRESSION_UNSUPPORTED', DATA_PORTABILITY_TEXT.zipStructureInvalid);
    }

    if (readUint32(view, localOffset) !== 0x04034b50) {
      throw new DataZipError('ZIP_STRUCTURE_INVALID', DATA_PORTABILITY_TEXT.zipStructureInvalid);
    }

    const localFilenameLength = readUint16(view, localOffset + 26);
    const localExtraLength = readUint16(view, localOffset + 28);
    const dataOffset = localOffset + 30 + localFilenameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;

    if (dataEnd > bytes.byteLength || compressedSize !== uncompressedSize) {
      throw new DataZipError('ZIP_STRUCTURE_INVALID', DATA_PORTABILITY_TEXT.zipStructureInvalid);
    }

    files.push({
      path,
      bytes: bytes.slice(dataOffset, dataEnd),
      compressedSize,
      uncompressedSize
    });

    offset += 46 + filenameLength + extraLength + commentLength;
  }

  return files;
}
