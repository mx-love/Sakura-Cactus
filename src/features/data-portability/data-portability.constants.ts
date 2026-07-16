export const BLOG_DATA_FORMAT = 'sakura-cactus-data';
export const BLOG_DATA_VERSION = 1;

export const DATA_PORTABILITY_LIMITS = {
  apiJsonRequestBytes: 1 * 1024 * 1024,
  apiFileRequestBytes: 32 * 1024 * 1024,
  jsonFileBytes: 4 * 1024 * 1024,
  zipFileBytes: 32 * 1024 * 1024,
  zipUncompressedBytes: 96 * 1024 * 1024,
  zipCompressionRatio: 30,
  mediaFileBytes: 5 * 1024 * 1024,
  mediaCount: 120,
  articles: 500,
  articleMarkdownChars: 200_000,
  totalMarkdownChars: 4_000_000,
  tags: 500,
  friends: 300,
  jsonDepth: 16,
  stringFieldChars: 4_000,
  inspectTokenTtlSeconds: 15 * 60
} as const;

export const DATA_PORTABILITY_TEXT = {
  fileTooLarge: '该文件超过当前站点单次导入限制。',
  tooManyMedia: '该文件包含的图片过多。',
  mediaTooLarge: '某个图片文件超过允许大小。',
  zipStructureInvalid: '该压缩文件结构异常。',
  unsupportedFile: '文件不完整、已损坏或格式不受支持。'
} as const;
