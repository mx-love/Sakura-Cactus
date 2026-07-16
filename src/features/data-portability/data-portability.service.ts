import { SESSION_COOKIE_NAME } from '@/features/auth/auth.constants';
import { bytesToBase64Url, createRandomId, createRandomToken, sha256Base64Url } from '@/features/auth/crypto.service';
import { getCookieValue, getSessionSecret, hashSessionToken } from '@/features/auth/auth.service';
import { findReusableAssetBySha256, refreshAssetUsageCounts } from '@/features/assets/asset.repo';
import { cleanupUnreferencedPostAssets, getMediaBucket } from '@/features/assets/asset.service';
import { normalizePublicHttpUrl } from '@/lib/security/external-url';
import type { AssetRow, FriendLinkRow, PostRow, TagRow } from '@/lib/database.types';
import { getDb, nowIso } from '@/lib/db';
import { reportError } from '@/lib/logging';
import { calculateReadingTimeMinutes, calculateWordCount, extractAssetTokens, renderMarkdown } from '@/features/posts/post.renderer';
import { DATA_PORTABILITY_LIMITS, DATA_PORTABILITY_TEXT, BLOG_DATA_FORMAT, BLOG_DATA_VERSION } from './data-portability.constants';
import { createDataZip, DataZipError, parseDataZip, type ParsedZipFile, type ZipInputFile } from './data-portability.zip';

export type DataSection = 'articles' | 'media' | 'friends';
export type ArticleConflictStrategy = 'skip' | 'overwrite' | 'copy';
export type FriendConflictStrategy = 'skip' | 'update';

export interface BlogDataSelections {
  articles: boolean;
  media: boolean;
  friends: boolean;
}

interface BlogDataArticle {
  type: 'article' | 'about';
  slug: string;
  title: string;
  excerpt: string | null;
  markdown: string;
  publishedAt: string;
  updatedAt: string;
  seoTitle: string | null;
  seoDescription: string | null;
  coverMediaToken: string | null;
  status?: 'published';
}

interface BlogDataTag {
  name: string;
  slug: string;
}

interface BlogDataArticleTagRelation {
  articleSlug: string;
  tagSlug: string;
}

interface BlogDataFriend {
  name: string;
  url: string;
  avatarUrl: string | null;
  description: string | null;
}

interface BlogDataMediaEntry {
  token: string;
  filename: string | null;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  archivePath?: string;
  usedBy: string[];
  coverFor: string[];
}

interface BlogDataFile {
  format: typeof BLOG_DATA_FORMAT;
  version: typeof BLOG_DATA_VERSION;
  createdAt: string;
  source: {
    generator: 'Sakura Cactus';
    origin: string;
  };
  selectedSections: BlogDataSelections;
  manifest: {
    counts: {
      articles: number;
      tags: number;
      articleTagRelations: number;
      media: number;
      friends: number;
    };
  };
  articles: BlogDataArticle[];
  aboutPage: BlogDataArticle | null;
  tags: BlogDataTag[];
  articleTagRelations: BlogDataArticleTagRelation[];
  friends?: BlogDataFriend[];
  mediaManifest?: BlogDataMediaEntry[];
  checksums: {
    contentSha256: string;
  };
}

interface ParsedBlogDataFile {
  data: BlogDataFile;
  fileHash: string;
  mediaFiles: Map<string, Uint8Array>;
  isZip: boolean;
}

export interface BlogDataSummary {
  publishedArticles: number;
  usedTags: number;
  referencedMedia: number;
  friends: number;
}

export interface BlogDataExportResult {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
  json: boolean;
}

export interface BlogDataInspectResult {
  ok: boolean;
  message: string;
  importPlanToken?: string;
  file: {
    articles: number;
    tags: number;
    media: number;
    friends: number;
    hasMediaFiles: boolean;
  };
  availableSections: BlogDataSelections;
  warnings: string[];
  conflicts: {
    articles: string[];
    aboutPage: boolean;
    friends: string[];
  };
}

export interface BlogDataImportOptions {
  importPlanToken: string;
  sections: BlogDataSelections;
  articleConflictStrategy: ArticleConflictStrategy;
  friendConflictStrategy: FriendConflictStrategy;
}

export interface BlogDataImportResult {
  articles: {
    created: number;
    overwritten: number;
    skipped: number;
  };
  tags: {
    created: number;
    reused: number;
  };
  media: {
    uploaded: number;
    reused: number;
    failed: number;
  };
  friends: {
    created: number;
    updated: number;
    skipped: number;
  };
  warnings: string[];
}

export class BlogDataError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = 'BlogDataError';
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const ABOUT_SLUG = 'about';
const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg'
};
const IMAGE_MAGIC: Record<string, number[][]> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/gif': [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]
  ],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
  'image/svg+xml': []
};

function normalizeSelections(raw: unknown): BlogDataSelections {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const selections = {
    articles: input.articles === true,
    media: input.media === true,
    friends: input.friends === true
  };

  if (selections.media && !selections.articles) {
    throw new BlogDataError('MEDIA_REQUIRES_ARTICLES', '文章图片需要和文章一起选择。');
  }

  if (!selections.articles && !selections.friends) {
    throw new BlogDataError('SECTION_REQUIRED', '至少选择一项博客数据。');
  }

  return selections;
}

export function normalizeBlogDataSelections(raw: unknown): BlogDataSelections {
  return normalizeSelections(raw);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).filter((key) => object[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytesToArrayBuffer(bytes));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function finalizeDataFile(input: Omit<BlogDataFile, 'checksums'>): Promise<BlogDataFile> {
  const contentSha256 = await sha256Base64Url(stableStringify(input));
  return {
    ...input,
    checksums: {
      contentSha256
    }
  };
}

async function verifyChecksum(data: BlogDataFile): Promise<void> {
  const { checksums, ...unsigned } = data;

  if (!checksums || typeof checksums.contentSha256 !== 'string') {
    throw new BlogDataError('CHECKSUM_REQUIRED', DATA_PORTABILITY_TEXT.unsupportedFile);
  }

  const actual = await sha256Base64Url(stableStringify(unsigned));

  if (actual !== checksums.contentSha256) {
    throw new BlogDataError('CHECKSUM_INVALID', DATA_PORTABILITY_TEXT.unsupportedFile);
  }
}

function assertJsonDepth(value: unknown, depth = 0): void {
  if (depth > DATA_PORTABILITY_LIMITS.jsonDepth) {
    throw new BlogDataError('JSON_TOO_DEEP', DATA_PORTABILITY_TEXT.unsupportedFile);
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      assertJsonDepth(item, depth + 1);
    }
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    assertSafeFieldName(key);

    if (typeof child === 'string' && child.length > DATA_PORTABILITY_LIMITS.articleMarkdownChars && key !== 'markdown') {
      throw new BlogDataError('STRING_TOO_LONG', DATA_PORTABILITY_TEXT.unsupportedFile);
    }

    assertJsonDepth(child, depth + 1);
  }
}

function assertSafeFieldName(key: string): void {
  const normalized = key.toLowerCase();
  const blockedExact = new Set([
    'id',
    'post_id',
    'asset_id',
    'user_id',
    'd1_id',
    'r2_id',
    'r2_key',
    'worker_id',
    'content_html',
    'contenthtml',
    'password_hash',
    'token_hash'
  ]);
  const blockedFragments = [
    'password',
    'secret',
    'session',
    'cookie',
    'csrf',
    'authorization',
    'apikey',
    'accesskey',
    'accesstoken',
    'refreshtoken',
    'cloudflare',
    'binding',
    'environment'
  ];

  if (blockedExact.has(normalized) || blockedFragments.some((fragment) => normalized.includes(fragment))) {
    throw new BlogDataError('SENSITIVE_FIELD_FOUND', DATA_PORTABILITY_TEXT.unsupportedFile);
  }
}

function assertString(value: unknown, field: string, max: number = DATA_PORTABILITY_LIMITS.stringFieldChars): string {
  if (typeof value !== 'string') {
    throw new BlogDataError('INVALID_FIELD', `${field} 格式不正确。`);
  }

  const trimmed = value.trim();

  if (!trimmed || trimmed.length > max) {
    throw new BlogDataError('INVALID_FIELD', `${field} 格式不正确。`);
  }

  return trimmed;
}

function assertSlug(value: unknown): string {
  const slug = assertString(value, 'Slug', 160);

  if (!/^[a-z0-9][a-z0-9-]{0,158}[a-z0-9]$|^about$/.test(slug)) {
    throw new BlogDataError('INVALID_SLUG', DATA_PORTABILITY_TEXT.unsupportedFile);
  }

  return slug;
}

function assertIso(value: unknown, field: string): string {
  const raw = assertString(value, field, 64);
  const timestamp = Date.parse(raw);

  if (!Number.isFinite(timestamp)) {
    throw new BlogDataError('INVALID_DATE', DATA_PORTABILITY_TEXT.unsupportedFile);
  }

  return new Date(timestamp).toISOString();
}

function assertDataShape(data: BlogDataFile): void {
  assertJsonDepth(data);

  if (data.format !== BLOG_DATA_FORMAT || data.version !== BLOG_DATA_VERSION) {
    throw new BlogDataError('UNSUPPORTED_VERSION', DATA_PORTABILITY_TEXT.unsupportedFile);
  }

  const selectedKeys = Object.keys(data.selectedSections ?? {});

  if (selectedKeys.some((key) => !['articles', 'media', 'friends'].includes(key))) {
    throw new BlogDataError('UNKNOWN_SECTION', DATA_PORTABILITY_TEXT.unsupportedFile);
  }

  const selections = normalizeSelections(data.selectedSections);
  const articles = Array.isArray(data.articles) ? data.articles : [];
  const aboutPage = data.aboutPage ?? null;
  const tags = Array.isArray(data.tags) ? data.tags : [];
  const relations = Array.isArray(data.articleTagRelations) ? data.articleTagRelations : [];
  const friends = Array.isArray(data.friends) ? data.friends : [];
  const media = Array.isArray(data.mediaManifest) ? data.mediaManifest : [];

  if (articles.length + (aboutPage ? 1 : 0) > DATA_PORTABILITY_LIMITS.articles) {
    throw new BlogDataError('TOO_MANY_ARTICLES', DATA_PORTABILITY_TEXT.fileTooLarge);
  }

  if (tags.length > DATA_PORTABILITY_LIMITS.tags || friends.length > DATA_PORTABILITY_LIMITS.friends) {
    throw new BlogDataError('TOO_MANY_ROWS', DATA_PORTABILITY_TEXT.fileTooLarge);
  }

  if (media.length > DATA_PORTABILITY_LIMITS.mediaCount) {
    throw new BlogDataError('TOO_MANY_MEDIA', DATA_PORTABILITY_TEXT.tooManyMedia);
  }

  let markdownLength = 0;
  const articleSlugs = new Set<string>();
  let aboutCount = aboutPage ? 1 : 0;

  for (const article of [...articles, ...(aboutPage ? [aboutPage] : [])]) {
    const slug = assertSlug(article.slug);

    if (article.status && article.status !== 'published') {
      throw new BlogDataError('INVALID_STATUS', DATA_PORTABILITY_TEXT.unsupportedFile);
    }

    if (slug === ABOUT_SLUG && article.type !== 'about') {
      aboutCount += 1;
    }

    if (articleSlugs.has(slug)) {
      throw new BlogDataError('DUPLICATE_ARTICLE', DATA_PORTABILITY_TEXT.unsupportedFile);
    }

    articleSlugs.add(slug);
    assertString(article.title, 'Title', 200);
    assertIso(article.publishedAt, 'Published At');
    assertIso(article.updatedAt, 'Updated At');

    if (typeof article.markdown !== 'string' || article.markdown.length > DATA_PORTABILITY_LIMITS.articleMarkdownChars) {
      throw new BlogDataError('ARTICLE_TOO_LARGE', DATA_PORTABILITY_TEXT.fileTooLarge);
    }

    markdownLength += article.markdown.length;
  }

  if (aboutCount > 1) {
    throw new BlogDataError('MULTIPLE_ABOUT', DATA_PORTABILITY_TEXT.unsupportedFile);
  }

  if (markdownLength > DATA_PORTABILITY_LIMITS.totalMarkdownChars) {
    throw new BlogDataError('MARKDOWN_TOO_LARGE', DATA_PORTABILITY_TEXT.fileTooLarge);
  }

  const tagSlugs = new Set<string>();

  for (const tag of tags) {
    tagSlugs.add(assertSlug(tag.slug));
    assertString(tag.name, 'Tag', 80);
  }

  for (const relation of relations) {
    const articleSlug = assertSlug(relation.articleSlug);
    const tagSlug = assertSlug(relation.tagSlug);

    if (!articleSlugs.has(articleSlug) || !tagSlugs.has(tagSlug)) {
      throw new BlogDataError('INVALID_TAG_RELATION', DATA_PORTABILITY_TEXT.unsupportedFile);
    }
  }

  for (const friend of friends) {
    assertString(friend.name, 'Friend name', 80);
    normalizePublicHttpUrl(assertString(friend.url, 'Friend URL', 500));

    if (friend.avatarUrl) {
      normalizePublicHttpUrl(friend.avatarUrl);
    }
  }

  for (const entry of media) {
    assertString(entry.token, 'Media token', 96);
    assertString(entry.mimeType, 'Media MIME', 80);
    assertString(entry.sha256, 'Media checksum', 128);

    if (!Object.hasOwn(IMAGE_MIME_EXTENSIONS, entry.mimeType)) {
      throw new BlogDataError('INVALID_MEDIA_TYPE', DATA_PORTABILITY_TEXT.unsupportedFile);
    }

    if (!Number.isInteger(entry.sizeBytes) || entry.sizeBytes < 0 || entry.sizeBytes > DATA_PORTABILITY_LIMITS.mediaFileBytes) {
      throw new BlogDataError('MEDIA_TOO_LARGE', DATA_PORTABILITY_TEXT.mediaTooLarge);
    }

    if (entry.archivePath) {
      assertString(entry.archivePath, 'Archive path', 240);
    }
  }

  const counts = data.manifest?.counts;

  if (!counts) {
    throw new BlogDataError('MANIFEST_REQUIRED', DATA_PORTABILITY_TEXT.unsupportedFile);
  }

  if (
    counts.articles !== articles.length + (aboutPage ? 1 : 0) ||
    counts.tags !== tags.length ||
    counts.articleTagRelations !== relations.length ||
    counts.media !== media.length ||
    counts.friends !== friends.length
  ) {
    throw new BlogDataError('COUNT_MISMATCH', DATA_PORTABILITY_TEXT.unsupportedFile);
  }

  if (selections.media && media.length === 0) {
    throw new BlogDataError('MEDIA_MANIFEST_REQUIRED', DATA_PORTABILITY_TEXT.unsupportedFile);
  }
}

function sanitizeFilename(value: string | null): string {
  const base = (value ?? 'image')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return base || 'image';
}

function mediaArchivePath(asset: AssetRow, usedPaths: Set<string>): string {
  const sha = (asset.sha256 ?? asset.token).slice(0, 16);
  const extension = IMAGE_MIME_EXTENSIONS[asset.mime_type] ?? 'bin';
  const filename = sanitizeFilename(asset.original_filename);
  const stem = filename.toLowerCase().endsWith(`.${extension}`) ? filename.slice(0, -(extension.length + 1)) : filename;
  let path = `media/${sha}-${stem}.${extension}`;
  let index = 2;

  while (usedPaths.has(path)) {
    path = `media/${sha}-${stem}-${index}.${extension}`;
    index += 1;
  }

  usedPaths.add(path);
  return path;
}

function timestampFilename(extension: 'json' | 'zip'): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `sakura-cactus-data-${timestamp}.${extension}`;
}

async function readR2ObjectBytes(object: R2ObjectBody): Promise<Uint8Array> {
  const reader = object.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const chunk = await reader.read();

    if (chunk.done) {
      break;
    }

    chunks.push(chunk.value);
    total += chunk.value.byteLength;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function publicPostWhere(now: string): string {
  return `posts.status = 'published'
    AND posts.visibility = 'public'
    AND posts.published_at IS NOT NULL
    AND posts.published_at <= '${now.replace(/'/g, "''")}'`;
}

async function listExportablePosts(db: D1Database): Promise<PostRow[]> {
  const now = nowIso();
  const result = await db
    .prepare(
      `SELECT id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
        seo_title, seo_description, reading_time_minutes, word_count, published_at, pinned_at, created_at, updated_at
       FROM posts
       WHERE ${publicPostWhere(now)}
       ORDER BY slug = 'about' ASC, published_at ASC, slug ASC`
    )
    .all<PostRow>();

  return result.results ?? [];
}

async function listTagsForPostIds(db: D1Database, postIds: string[]): Promise<Map<string, TagRow[]>> {
  const tagsByPost = new Map<string, TagRow[]>();

  if (postIds.length === 0) {
    return tagsByPost;
  }

  const placeholders = postIds.map(() => '?').join(', ');
  const result = await db
    .prepare(
      `SELECT post_tags.post_id, tags.id, tags.name, tags.slug, tags.color, tags.created_at, tags.updated_at
       FROM post_tags
       INNER JOIN tags ON tags.id = post_tags.tag_id
       WHERE post_tags.post_id IN (${placeholders})
       ORDER BY tags.name ASC`
    )
    .bind(...postIds)
    .all<TagRow & { post_id: string }>();

  for (const row of result.results ?? []) {
    const list = tagsByPost.get(row.post_id) ?? [];
    list.push(row);
    tagsByPost.set(row.post_id, list);
  }

  return tagsByPost;
}

async function listApprovedFriends(db: D1Database): Promise<FriendLinkRow[]> {
  const result = await db
    .prepare(
      `SELECT id, name, url, avatar_url, description, status, sort_order,
        health_status, last_checked_at, last_status_code, last_error, consecutive_failures, created_at, updated_at
       FROM friend_links
       WHERE status = 'approved'
       ORDER BY created_at ASC`
    )
    .all<FriendLinkRow>();

  return result.results ?? [];
}

async function listReferencedAssets(db: D1Database, posts: PostRow[]): Promise<Map<string, AssetRow>> {
  const postIds = posts.map((post) => post.id);
  const assets = new Map<string, AssetRow>();

  if (postIds.length === 0) {
    return assets;
  }

  const placeholders = postIds.map(() => '?').join(', ');
  const values: unknown[] = [...postIds, ...postIds];
  const result = await db
    .prepare(
      `SELECT DISTINCT assets.id, assets.token, assets.r2_key, assets.original_filename, assets.mime_type,
        assets.size_bytes, assets.width, assets.height, assets.sha256, assets.visibility, assets.usage_count,
        assets.created_by, assets.created_at, assets.updated_at, assets.deleted_at
       FROM assets
       WHERE assets.deleted_at IS NULL
         AND assets.visibility != 'deleted'
         AND assets.id IN (
      SELECT asset_id FROM post_assets WHERE post_id IN (${placeholders})
      UNION
      SELECT cover_asset_id FROM posts WHERE id IN (${placeholders}) AND cover_asset_id IS NOT NULL
    )`
    )
    .bind(...values)
    .all<AssetRow>();

  for (const asset of result.results ?? []) {
    assets.set(asset.id, asset);
  }

  return assets;
}

async function buildExportData(selections: BlogDataSelections, sourceOrigin: string): Promise<{ data: BlogDataFile; mediaAssets: AssetRow[] }> {
  const db = getDb();
  const posts = selections.articles ? await listExportablePosts(db) : [];
  const friends = selections.friends ? await listApprovedFriends(db) : [];
  const tagsByPost = await listTagsForPostIds(db, posts.map((post) => post.id));
  const tagMap = new Map<string, BlogDataTag>();
  const relations: BlogDataArticleTagRelation[] = [];
  const articleRows: BlogDataArticle[] = [];
  let aboutPage: BlogDataArticle | null = null;
  const assetsById = selections.articles ? await listReferencedAssets(db, posts) : new Map<string, AssetRow>();
  const mediaEntries = new Map<string, BlogDataMediaEntry>();

  for (const post of posts) {
    const article: BlogDataArticle = {
      type: post.slug === ABOUT_SLUG ? 'about' : 'article',
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      markdown: post.content_markdown,
      publishedAt: post.published_at ?? post.created_at,
      updatedAt: post.updated_at,
      seoTitle: post.seo_title,
      seoDescription: post.seo_description,
      coverMediaToken: null
    };

    const tagRows = tagsByPost.get(post.id) ?? [];

    for (const tag of tagRows) {
      tagMap.set(tag.slug, { name: tag.name, slug: tag.slug });
      relations.push({ articleSlug: post.slug, tagSlug: tag.slug });
    }

    const inlineTokens = new Set(extractAssetTokens(post.content_markdown));

    for (const asset of assetsById.values()) {
      const usedInline = inlineTokens.has(asset.token);
      const usedCover = post.cover_asset_id === asset.id;

      if (!usedInline && !usedCover) {
        continue;
      }

      const entry = mediaEntries.get(asset.id) ?? {
        token: asset.token,
        filename: asset.original_filename,
        mimeType: asset.mime_type,
        sizeBytes: asset.size_bytes,
        sha256: asset.sha256 ?? '',
        usedBy: [],
        coverFor: []
      };

      if (usedInline) {
        entry.usedBy.push(post.slug);
      }

      if (usedCover) {
        article.coverMediaToken = asset.token;
        entry.coverFor.push(post.slug);
      }

      mediaEntries.set(asset.id, entry);
    }

    if (article.type === 'about') {
      aboutPage = article;
    } else {
      articleRows.push(article);
    }
  }

  const mediaAssets = [...assetsById.values()].filter((asset) => mediaEntries.has(asset.id));
  const mediaManifest = [...mediaEntries.values()].sort((a, b) => a.token.localeCompare(b.token));
  const selectedSections = {
    articles: selections.articles,
    media: selections.media,
    friends: selections.friends
  };
  const data = await finalizeDataFile({
    format: BLOG_DATA_FORMAT,
    version: BLOG_DATA_VERSION,
    createdAt: nowIso(),
    source: {
      generator: 'Sakura Cactus',
      origin: sourceOrigin
    },
    selectedSections,
    manifest: {
      counts: {
        articles: articleRows.length + (aboutPage ? 1 : 0),
        tags: tagMap.size,
        articleTagRelations: relations.length,
        media: mediaManifest.length,
        friends: friends.length
      }
    },
    articles: articleRows,
    aboutPage,
    tags: [...tagMap.values()].sort((a, b) => a.slug.localeCompare(b.slug)),
    articleTagRelations: relations.sort((a, b) => `${a.articleSlug}:${a.tagSlug}`.localeCompare(`${b.articleSlug}:${b.tagSlug}`)),
    friends: selections.friends
      ? friends.map((friend) => ({
          name: friend.name,
          url: friend.url,
          avatarUrl: friend.avatar_url,
          description: friend.description
        }))
      : undefined,
    mediaManifest: mediaManifest.length > 0 ? mediaManifest : undefined
  });

  return { data, mediaAssets };
}

export async function getBlogDataSummary(): Promise<BlogDataSummary> {
  const db = getDb();
  const now = nowIso();
  const [articles, tags, media, friends] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count FROM posts WHERE ${publicPostWhere(now)}`).first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(DISTINCT tags.id) AS count
         FROM tags
         INNER JOIN post_tags ON post_tags.tag_id = tags.id
         INNER JOIN posts ON posts.id = post_tags.post_id
         WHERE ${publicPostWhere(now)}`
      )
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(DISTINCT assets.id) AS count
         FROM assets
         WHERE assets.deleted_at IS NULL
           AND assets.visibility != 'deleted'
           AND assets.id IN (
             SELECT post_assets.asset_id
             FROM post_assets
             INNER JOIN posts ON posts.id = post_assets.post_id
             WHERE ${publicPostWhere(now)}
             UNION
             SELECT posts.cover_asset_id
             FROM posts
             WHERE ${publicPostWhere(now)} AND posts.cover_asset_id IS NOT NULL
           )`
      )
      .first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM friend_links WHERE status = 'approved'").first<{ count: number }>()
  ]);

  return {
    publishedArticles: articles?.count ?? 0,
    usedTags: tags?.count ?? 0,
    referencedMedia: media?.count ?? 0,
    friends: friends?.count ?? 0
  };
}

export async function exportBlogData(rawSelections: unknown, sourceOrigin: string): Promise<BlogDataExportResult> {
  const selections = normalizeSelections(rawSelections);
  const { data, mediaAssets } = await buildExportData(selections, sourceOrigin);
  const jsonBytes = textEncoder.encode(JSON.stringify(data, null, 2));

  if (!selections.media) {
    return {
      bytes: jsonBytes,
      contentType: 'application/json; charset=utf-8',
      filename: timestampFilename('json'),
      json: true
    };
  }

  const bucket = getMediaBucket();
  const usedPaths = new Set<string>(['manifest.json', 'data.json']);
  const mediaFiles: ZipInputFile[] = [];
  const dataWithPaths: BlogDataFile = JSON.parse(JSON.stringify(data));

  for (const entry of dataWithPaths.mediaManifest ?? []) {
    const asset = mediaAssets.find((candidate) => candidate.token === entry.token);

    if (!asset) {
      throw new BlogDataError('MEDIA_NOT_FOUND', '图片文件不完整，无法导出。', 409);
    }

    const object = await bucket.get(asset.r2_key);

    if (!object) {
      throw new BlogDataError('MEDIA_OBJECT_MISSING', '图片文件不完整，无法导出。', 409);
    }

    const bytes = await readR2ObjectBytes(object);
    const checksum = await sha256Bytes(bytes);

    if (entry.sha256 && checksum !== entry.sha256) {
      throw new BlogDataError('MEDIA_CHECKSUM_MISMATCH', '图片文件不完整，无法导出。', 409);
    }

    entry.archivePath = mediaArchivePath(asset, usedPaths);
    mediaFiles.push({ path: entry.archivePath, bytes });
  }

  const unsignedDataWithPaths = { ...dataWithPaths };
  delete (unsignedDataWithPaths as Partial<BlogDataFile>).checksums;
  const finalizedData = await finalizeDataFile(unsignedDataWithPaths as Omit<BlogDataFile, 'checksums'>);
  const finalizedJsonBytes = textEncoder.encode(JSON.stringify(finalizedData, null, 2));
  const manifest = {
    format: BLOG_DATA_FORMAT,
    version: BLOG_DATA_VERSION,
    createdAt: finalizedData.createdAt,
    selectedSections: finalizedData.selectedSections,
    counts: finalizedData.manifest.counts,
    files: [
      {
        path: 'data.json',
        sizeBytes: finalizedJsonBytes.byteLength,
        sha256: await sha256Bytes(finalizedJsonBytes)
      },
      ...mediaFiles.map((file) => ({
        path: file.path,
        sizeBytes: file.bytes.byteLength,
        sha256: (finalizedData.mediaManifest ?? []).find((entry) => entry.archivePath === file.path)?.sha256 ?? ''
      }))
    ],
    mediaTotalBytes: mediaFiles.reduce((sum, file) => sum + file.bytes.byteLength, 0)
  };
  const zipBytes = createDataZip([
    { path: 'manifest.json', bytes: textEncoder.encode(JSON.stringify(manifest, null, 2)) },
    { path: 'data.json', bytes: finalizedJsonBytes },
    ...mediaFiles
  ]);

  return {
    bytes: zipBytes,
    contentType: 'application/zip',
    filename: timestampFilename('zip'),
    json: false
  };
}

async function parseJsonBytes(bytes: Uint8Array): Promise<BlogDataFile> {
  if (bytes.byteLength > DATA_PORTABILITY_LIMITS.jsonFileBytes) {
    throw new BlogDataError('FILE_TOO_LARGE', DATA_PORTABILITY_TEXT.fileTooLarge, 413);
  }

  let data: BlogDataFile;

  try {
    data = JSON.parse(textDecoder.decode(bytes)) as BlogDataFile;
  } catch {
    throw new BlogDataError('INVALID_JSON', DATA_PORTABILITY_TEXT.unsupportedFile);
  }

  assertDataShape(data);
  await verifyChecksum(data);
  return data;
}

async function parseBlogDataFile(file: File): Promise<ParsedBlogDataFile> {
  const input = new Uint8Array(await file.arrayBuffer());
  const fileHash = await sha256Bytes(input);
  const name = file.name.toLowerCase();
  const isZip = name.endsWith('.zip') || file.type === 'application/zip';

  if (isZip) {
    let files: ParsedZipFile[];

    try {
      files = parseDataZip(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
    } catch (error) {
      if (error instanceof DataZipError) {
        throw new BlogDataError(error.code, error.message, 400);
      }

      throw error;
    }

    const fileMap = new Map(files.map((entry) => [entry.path, entry.bytes]));
    const dataBytes = fileMap.get('data.json');
    const manifestBytes = fileMap.get('manifest.json');

    if (!dataBytes || !manifestBytes) {
      throw new BlogDataError('ZIP_MANIFEST_REQUIRED', DATA_PORTABILITY_TEXT.zipStructureInvalid);
    }

    const data = await parseJsonBytes(dataBytes);
    let manifest: { files?: Array<{ path: string; sizeBytes: number; sha256: string }> };

    try {
      manifest = JSON.parse(textDecoder.decode(manifestBytes)) as { files?: Array<{ path: string; sizeBytes: number; sha256: string }> };
    } catch {
      throw new BlogDataError('ZIP_MANIFEST_INVALID', DATA_PORTABILITY_TEXT.zipStructureInvalid);
    }
    const declaredPaths = new Set(['manifest.json', 'data.json']);

    for (const entry of data.mediaManifest ?? []) {
      if (!entry.archivePath) {
        throw new BlogDataError('MEDIA_FILE_MISSING', DATA_PORTABILITY_TEXT.unsupportedFile);
      }

      declaredPaths.add(entry.archivePath);
      const bytes = fileMap.get(entry.archivePath);

      if (!bytes) {
        throw new BlogDataError('MEDIA_FILE_MISSING', DATA_PORTABILITY_TEXT.unsupportedFile);
      }

      const checksum = await sha256Bytes(bytes);

      if (checksum !== entry.sha256) {
        throw new BlogDataError('MEDIA_CHECKSUM_INVALID', DATA_PORTABILITY_TEXT.unsupportedFile);
      }
    }

    for (const entry of files) {
      if (!declaredPaths.has(entry.path)) {
        throw new BlogDataError('ZIP_EXTRA_FILE', DATA_PORTABILITY_TEXT.zipStructureInvalid);
      }
    }

    for (const item of manifest.files ?? []) {
      const bytes = fileMap.get(item.path);

      if (!bytes || bytes.byteLength !== item.sizeBytes || (await sha256Bytes(bytes)) !== item.sha256) {
        throw new BlogDataError('MANIFEST_CHECKSUM_INVALID', DATA_PORTABILITY_TEXT.unsupportedFile);
      }
    }

    const mediaFiles = new Map<string, Uint8Array>();

    for (const entry of data.mediaManifest ?? []) {
      if (entry.archivePath) {
        const bytes = fileMap.get(entry.archivePath);

        if (bytes) {
          mediaFiles.set(entry.archivePath, bytes);
        }
      }
    }

    return {
      data,
      fileHash,
      mediaFiles,
      isZip: true
    };
  }

  const data = await parseJsonBytes(input);
  return {
    data,
    fileHash,
    mediaFiles: new Map(),
    isZip: false
  };
}

async function getSessionBinding(request: Request): Promise<string> {
  const token = getCookieValue(request, SESSION_COOKIE_NAME);

  if (!token) {
    throw new BlogDataError('AUTH_REQUIRED', 'Authentication required.', 401);
  }

  return hashSessionToken(token, getSessionSecret());
}

async function signPlanToken(payload: Record<string, unknown>): Promise<string> {
  const body = bytesToBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const signature = await sha256Base64Url(`${getSessionSecret()}.${body}`);
  return `${body}.${signature}`;
}

async function verifyPlanToken(token: string, fileHash: string, request: Request): Promise<void> {
  const [body, signature] = token.split('.');

  if (!body || !signature) {
    throw new BlogDataError('IMPORT_PLAN_INVALID', DATA_PORTABILITY_TEXT.unsupportedFile);
  }

  const expected = await sha256Base64Url(`${getSessionSecret()}.${body}`);

  if (expected !== signature) {
    throw new BlogDataError('IMPORT_PLAN_INVALID', DATA_PORTABILITY_TEXT.unsupportedFile);
  }

  let payload: { fileHash?: string; session?: string; expiresAt?: number };

  try {
    payload = JSON.parse(textDecoder.decode(Uint8Array.from(atob(body.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(body.length / 4) * 4, '=')), (char) => char.charCodeAt(0))));
  } catch {
    throw new BlogDataError('IMPORT_PLAN_INVALID', DATA_PORTABILITY_TEXT.unsupportedFile);
  }

  if ((payload.expiresAt ?? 0) < Math.floor(Date.now() / 1000)) {
    throw new BlogDataError('IMPORT_PLAN_EXPIRED', DATA_PORTABILITY_TEXT.unsupportedFile);
  }

  if (payload.fileHash !== fileHash || payload.session !== (await getSessionBinding(request))) {
    throw new BlogDataError('IMPORT_PLAN_MISMATCH', DATA_PORTABILITY_TEXT.unsupportedFile);
  }
}

function allImportArticles(data: BlogDataFile): BlogDataArticle[] {
  return [...data.articles, ...(data.aboutPage ? [data.aboutPage] : [])];
}

async function collectConflicts(data: BlogDataFile): Promise<BlogDataInspectResult['conflicts']> {
  const db = getDb();
  const conflicts = {
    articles: [] as string[],
    aboutPage: false,
    friends: [] as string[]
  };

  for (const article of allImportArticles(data)) {
    const row = await db.prepare('SELECT slug FROM posts WHERE slug = ? LIMIT 1').bind(article.slug).first<{ slug: string }>();

    if (row && article.slug === ABOUT_SLUG) {
      conflicts.aboutPage = true;
    } else if (row) {
      conflicts.articles.push(article.slug);
    }
  }

  for (const friend of data.friends ?? []) {
    const row = await db.prepare('SELECT url FROM friend_links WHERE url = ? LIMIT 1').bind(friend.url).first<{ url: string }>();

    if (row) {
      conflicts.friends.push(friend.url);
    }
  }

  return conflicts;
}

export async function inspectBlogDataFile(file: File, request: Request): Promise<BlogDataInspectResult> {
  const parsed = await parseBlogDataFile(file);
  const token = await signPlanToken({
    fileHash: parsed.fileHash,
    session: await getSessionBinding(request),
    expiresAt: Math.floor(Date.now() / 1000) + DATA_PORTABILITY_LIMITS.inspectTokenTtlSeconds
  });
  const conflicts = await collectConflicts(parsed.data);
  const warnings: string[] = [];

  if (parsed.data.selectedSections.articles && !parsed.data.selectedSections.media) {
    warnings.push('未包含图片文件。导入其他站点后，原站图片链接可能仍依赖原站可访问。');
  }

  return {
    ok: true,
    message: '文件可用，可以导入。',
    importPlanToken: token,
    file: {
      articles: parsed.data.manifest.counts.articles,
      tags: parsed.data.manifest.counts.tags,
      media: parsed.data.manifest.counts.media,
      friends: parsed.data.manifest.counts.friends,
      hasMediaFiles: parsed.isZip && parsed.mediaFiles.size > 0
    },
    availableSections: parsed.data.selectedSections,
    warnings,
    conflicts
  };
}

function assertImageBytes(bytes: Uint8Array, mimeType: string): void {
  if (bytes.byteLength > DATA_PORTABILITY_LIMITS.mediaFileBytes) {
    throw new BlogDataError('MEDIA_TOO_LARGE', DATA_PORTABILITY_TEXT.mediaTooLarge);
  }

  const signatures = IMAGE_MAGIC[mimeType];

  if (!signatures) {
    throw new BlogDataError('INVALID_MEDIA_TYPE', DATA_PORTABILITY_TEXT.unsupportedFile);
  }

  if (mimeType === 'image/svg+xml') {
    const text = textDecoder.decode(bytes.slice(0, Math.min(bytes.byteLength, 512))).trim().toLowerCase();

    if (!text.startsWith('<svg') && !text.includes('<svg')) {
      throw new BlogDataError('INVALID_MEDIA_TYPE', DATA_PORTABILITY_TEXT.unsupportedFile);
    }

    return;
  }

  const ok = signatures.some((signature) => signature.every((byte, index) => bytes[index] === byte));

  if (!ok) {
    throw new BlogDataError('INVALID_MEDIA_TYPE', DATA_PORTABILITY_TEXT.unsupportedFile);
  }
}

function importedR2Key(mimeType: string): string {
  const date = new Date();
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `imports/${year}/${month}/${createRandomToken(16)}.${IMAGE_MIME_EXTENSIONS[mimeType] ?? 'bin'}`;
}

function rewriteInternalMedia(markdown: string, mediaTokenMap: Map<string, string>, sourceOrigin: string, includeMedia: boolean): string {
  return markdown.replace(/(!\[[^\]]*]\(\s*)(?:asset:|\/i\/)([A-Za-z0-9_-]{24,64})(\s*\))/g, (_match, prefix: string, token: string, suffix: string) => {
    const mappedToken = mediaTokenMap.get(token);

    if (includeMedia && mappedToken) {
      return `${prefix}asset:${mappedToken}${suffix}`;
    }

    const origin = sourceOrigin.replace(/\/+$/, '');
    return `${prefix}${origin}/i/${token}${suffix}`;
  });
}

async function findPostBySlugRaw(db: D1Database, slug: string): Promise<PostRow | null> {
  return db
    .prepare(
      `SELECT id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
        seo_title, seo_description, reading_time_minutes, word_count, published_at, pinned_at, created_at, updated_at
       FROM posts WHERE slug = ? LIMIT 1`
    )
    .bind(slug)
    .first<PostRow>();
}

async function findTagBySlugRaw(db: D1Database, slug: string): Promise<TagRow | null> {
  return db.prepare('SELECT id, name, slug, color, created_at, updated_at FROM tags WHERE slug = ? LIMIT 1').bind(slug).first<TagRow>();
}

async function findFriendByUrl(db: D1Database, url: string): Promise<FriendLinkRow | null> {
  return db
    .prepare(
      `SELECT id, name, url, avatar_url, description, status, sort_order,
        health_status, last_checked_at, last_status_code, last_error, consecutive_failures, created_at, updated_at
       FROM friend_links WHERE url = ? LIMIT 1`
    )
    .bind(url)
    .first<FriendLinkRow>();
}

async function uniqueImportedSlug(db: D1Database, slug: string): Promise<string> {
  const base = `${slug}-imported`.slice(0, 150);

  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;
    const row = await findPostBySlugRaw(db, candidate);

    if (!row) {
      return candidate;
    }
  }

  throw new BlogDataError('SLUG_CONFLICT', '无法生成可用的副本链接。', 409);
}

type Statement = ReturnType<D1Database['prepare']>;

interface PreparedMediaImport {
  tokenMap: Map<string, string>;
  assetIdByToken: Map<string, string>;
  assetInsertStatements: Statement[];
  uploadedAssets: Array<{ r2Key: string; assetId: string }>;
  result: BlogDataImportResult['media'];
}

async function prepareMediaImport(db: D1Database, parsed: ParsedBlogDataFile, includeMedia: boolean): Promise<PreparedMediaImport> {
  const tokenMap = new Map<string, string>();
  const assetIdByToken = new Map<string, string>();
  const assetInsertStatements: Statement[] = [];
  const uploadedAssets: Array<{ r2Key: string; assetId: string }> = [];
  const result = { uploaded: 0, reused: 0, failed: 0 };

  if (!includeMedia) {
    return { tokenMap, assetIdByToken, assetInsertStatements, uploadedAssets, result };
  }

  const bucket = getMediaBucket();

  for (const entry of parsed.data.mediaManifest ?? []) {
    const path = entry.archivePath;
    const bytes = path ? parsed.mediaFiles.get(path) : undefined;

    if (!bytes) {
      throw new BlogDataError('MEDIA_FILE_MISSING', DATA_PORTABILITY_TEXT.unsupportedFile);
    }

    assertImageBytes(bytes, entry.mimeType);
    const checksum = await sha256Bytes(bytes);

    if (checksum !== entry.sha256) {
      throw new BlogDataError('MEDIA_CHECKSUM_INVALID', DATA_PORTABILITY_TEXT.unsupportedFile);
    }

    const reusable = await findReusableAssetBySha256(db, entry.sha256, entry.mimeType, entry.sizeBytes);

    if (reusable) {
      tokenMap.set(entry.token, reusable.token);
      assetIdByToken.set(reusable.token, reusable.id);
      result.reused += 1;
      continue;
    }

    const token = createRandomToken(24);
    const r2Key = importedR2Key(entry.mimeType);
    const assetId = createRandomId('asset');

    try {
      await bucket.put(r2Key, bytesToArrayBuffer(bytes), {
        httpMetadata: {
          contentType: entry.mimeType
        }
      });
    } catch (error) {
      result.failed += 1;
      reportError('Blog data media upload failed.', error, {
        token: entry.token,
        archivePath: entry.archivePath ?? ''
      });
      await cleanupUploadedMedia(uploadedAssets);
      throw new BlogDataError('MEDIA_UPLOAD_FAILED', '图片上传失败，未写入文章。', 502);
    }

    uploadedAssets.push({ r2Key, assetId });
    tokenMap.set(entry.token, token);
    assetIdByToken.set(token, assetId);
    result.uploaded += 1;
    assetInsertStatements.push(
      db
        .prepare(
          `INSERT INTO assets (
            id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
            visibility, usage_count, created_by, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'public', 0, 'env_admin', ?, ?, NULL)`
        )
        .bind(assetId, token, r2Key, entry.filename, entry.mimeType, entry.sizeBytes, entry.sha256, nowIso(), nowIso())
    );
  }

  return { tokenMap, assetIdByToken, assetInsertStatements, uploadedAssets, result };
}

async function cleanupUploadedMedia(uploadedAssets: Array<{ r2Key: string; assetId: string }>): Promise<void> {
  const bucket = getMediaBucket();

  for (const asset of uploadedAssets) {
    try {
      await bucket.delete(asset.r2Key);
    } catch (error) {
      reportError('Blog data import uploaded media rollback failed.', error, {
        assetId: asset.assetId,
        r2Key: asset.r2Key
      });
    }
  }
}

export async function importBlogDataFile(file: File, request: Request, rawOptions: unknown): Promise<BlogDataImportResult> {
  const options = rawOptions && typeof rawOptions === 'object' ? (rawOptions as Record<string, unknown>) : {};
  const importPlanToken = assertString(options.importPlanToken, 'Import plan token', 4096);
  const sections = normalizeSelections(options.sections);
  const articleConflictStrategy = ['skip', 'overwrite', 'copy'].includes(String(options.articleConflictStrategy))
    ? (options.articleConflictStrategy as ArticleConflictStrategy)
    : 'skip';
  const friendConflictStrategy = options.friendConflictStrategy === 'update' ? 'update' : 'skip';
  const parsed = await parseBlogDataFile(file);

  await verifyPlanToken(importPlanToken, parsed.fileHash, request);

  if (sections.media && (!parsed.isZip || parsed.mediaFiles.size === 0)) {
    throw new BlogDataError('MEDIA_FILE_MISSING', DATA_PORTABILITY_TEXT.unsupportedFile);
  }

  if (sections.articles && !parsed.data.selectedSections.articles) {
    throw new BlogDataError('SECTION_UNAVAILABLE', DATA_PORTABILITY_TEXT.unsupportedFile);
  }

  if (sections.friends && !parsed.data.selectedSections.friends) {
    throw new BlogDataError('SECTION_UNAVAILABLE', DATA_PORTABILITY_TEXT.unsupportedFile);
  }

  if (sections.media && !parsed.data.selectedSections.media) {
    throw new BlogDataError('SECTION_UNAVAILABLE', DATA_PORTABILITY_TEXT.unsupportedFile);
  }

  const db = getDb();
  const mediaImport = await prepareMediaImport(db, parsed, sections.media);
  const statements: Statement[] = [...mediaImport.assetInsertStatements];
  const result: BlogDataImportResult = {
    articles: { created: 0, overwritten: 0, skipped: 0 },
    tags: { created: 0, reused: 0 },
    media: mediaImport.result,
    friends: { created: 0, updated: 0, skipped: 0 },
    warnings: []
  };
  const now = nowIso();
  const oldAssetIds = new Set<string>();

  try {
    if (sections.articles) {
      const tagIdBySlug = new Map<string, string>();

      for (const tag of parsed.data.tags) {
        const existing = await findTagBySlugRaw(db, tag.slug);

        if (existing) {
          tagIdBySlug.set(tag.slug, existing.id);
          result.tags.reused += 1;
          continue;
        }

        const tagId = createRandomId('tag');
        tagIdBySlug.set(tag.slug, tagId);
        result.tags.created += 1;
        statements.push(
          db
            .prepare('INSERT INTO tags (id, name, slug, color, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)')
            .bind(tagId, tag.name, tag.slug, now, now)
        );
      }

      const relationsBySlug = new Map<string, string[]>();

      for (const relation of parsed.data.articleTagRelations) {
        const list = relationsBySlug.get(relation.articleSlug) ?? [];
        list.push(relation.tagSlug);
        relationsBySlug.set(relation.articleSlug, list);
      }

      for (const article of allImportArticles(parsed.data)) {
        const existing = await findPostBySlugRaw(db, article.slug);
        const isAbout = article.slug === ABOUT_SLUG || article.type === 'about';
        let targetSlug = article.slug;
        let targetId = existing?.id ?? createRandomId('p');
        let action: 'create' | 'overwrite' | 'skip' = existing ? 'skip' : 'create';

        if (existing && articleConflictStrategy === 'overwrite') {
          action = 'overwrite';
        } else if (existing && articleConflictStrategy === 'copy' && !isAbout) {
          targetSlug = await uniqueImportedSlug(db, article.slug);
          targetId = createRandomId('p');
          action = 'create';
        } else if (existing) {
          action = 'skip';
        }

        if (action === 'skip') {
          result.articles.skipped += 1;
          continue;
        }

        if (existing) {
          const oldAssets = await db
            .prepare(
              `SELECT asset_id FROM post_assets WHERE post_id = ?
               UNION
               SELECT cover_asset_id AS asset_id FROM posts WHERE id = ? AND cover_asset_id IS NOT NULL`
            )
            .bind(existing.id, existing.id)
            .all<{ asset_id: string }>();

          for (const row of oldAssets.results ?? []) {
            oldAssetIds.add(row.asset_id);
          }
        }

        const rewrittenMarkdown = rewriteInternalMedia(article.markdown, mediaImport.tokenMap, parsed.data.source.origin, sections.media);
        const contentHtml = renderMarkdown(rewrittenMarkdown);
        const inlineTokens = extractAssetTokens(rewrittenMarkdown);
        const inlineAssetIds = [...new Set(inlineTokens.map((token) => mediaImport.assetIdByToken.get(token)).filter(Boolean))] as string[];
        const coverToken = article.coverMediaToken ? mediaImport.tokenMap.get(article.coverMediaToken) : null;
        const coverAssetId = coverToken ? mediaImport.assetIdByToken.get(coverToken) ?? null : null;
        const publishedAt = assertIso(article.publishedAt, 'Published At');

        if (action === 'create') {
          statements.push(
            db
              .prepare(
                `INSERT INTO posts (
                  id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
                  seo_title, seo_description, reading_time_minutes, word_count, published_at, pinned_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'published', 'public', ?, ?, ?, ?, ?, NULL, ?, ?)`
              )
              .bind(
                targetId,
                targetSlug,
                article.title,
                article.excerpt,
                rewrittenMarkdown,
                contentHtml,
                coverAssetId,
                article.seoTitle,
                article.seoDescription,
                calculateReadingTimeMinutes(rewrittenMarkdown),
                calculateWordCount(rewrittenMarkdown),
                publishedAt,
                now,
                now
              )
          );
          result.articles.created += 1;
        } else {
          statements.push(
            db
              .prepare(
                `UPDATE posts
                 SET title = ?, excerpt = ?, content_markdown = ?, content_html = ?, cover_asset_id = ?,
                     status = 'published', visibility = 'public', seo_title = ?, seo_description = ?,
                     reading_time_minutes = ?, word_count = ?, published_at = ?, updated_at = ?
                 WHERE id = ?`
              )
              .bind(
                article.title,
                article.excerpt,
                rewrittenMarkdown,
                contentHtml,
                coverAssetId,
                article.seoTitle,
                article.seoDescription,
                calculateReadingTimeMinutes(rewrittenMarkdown),
                calculateWordCount(rewrittenMarkdown),
                publishedAt,
                now,
                targetId
              )
          );
          result.articles.overwritten += 1;
        }

        statements.push(db.prepare('DELETE FROM post_tags WHERE post_id = ?').bind(targetId));
        statements.push(db.prepare('DELETE FROM post_assets WHERE post_id = ?').bind(targetId));

        for (const tagSlug of relationsBySlug.get(article.slug) ?? []) {
          const tagId = tagIdBySlug.get(tagSlug);

          if (tagId) {
            statements.push(db.prepare('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)').bind(targetId, tagId));
          }
        }

        for (const assetId of inlineAssetIds) {
          statements.push(
            db
              .prepare("INSERT INTO post_assets (post_id, asset_id, role, created_at) VALUES (?, ?, 'inline', ?)")
              .bind(targetId, assetId, now)
          );
        }
      }
    }

    if (sections.friends) {
      for (const friend of parsed.data.friends ?? []) {
        const existing = await findFriendByUrl(db, friend.url);

        if (existing && friendConflictStrategy === 'skip') {
          result.friends.skipped += 1;
          continue;
        }

        if (existing) {
          statements.push(
            db
              .prepare(
                `UPDATE friend_links
                 SET name = ?, avatar_url = ?, description = ?, status = 'approved', updated_at = ?
                 WHERE id = ?`
              )
              .bind(friend.name, friend.avatarUrl, friend.description, now, existing.id)
          );
          result.friends.updated += 1;
        } else {
          statements.push(
            db
              .prepare(
                `INSERT INTO friend_links (
                  id, name, url, avatar_url, description, status, sort_order, health_status,
                  last_checked_at, last_status_code, last_error, consecutive_failures, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'approved', 0, 'unknown', NULL, NULL, NULL, 0, ?, ?)`
              )
              .bind(createRandomId('fl'), friend.name, friend.url, friend.avatarUrl, friend.description, now, now)
          );
          result.friends.created += 1;
        }
      }
    }

    if (statements.length > 0) {
      await db.batch(statements);
    }
  } catch (error) {
    await cleanupUploadedMedia(mediaImport.uploadedAssets);
    throw error;
  }

  const affectedAssetIds = [...new Set([...oldAssetIds, ...mediaImport.assetIdByToken.values()])];

  if (affectedAssetIds.length > 0) {
    try {
      const unused = await refreshAssetUsageCounts(db, affectedAssetIds);
      await cleanupUnreferencedPostAssets(db, 'blog-data-import', unused);
    } catch (error) {
      reportError('Blog data import media cleanup failed.', error, {
        assetIds: affectedAssetIds.join(',')
      });
      result.warnings.push('部分旧图片需要稍后清理。');
    }
  }

  if (sections.articles && !sections.media && (parsed.data.mediaManifest?.length ?? 0) > 0) {
    result.warnings.push('未导入图片文件，文章中的原站图片链接可能仍依赖原站可访问。');
  }

  return result;
}

export function isBlogDataError(error: unknown): error is BlogDataError {
  return error instanceof BlogDataError;
}

export type { BlogDataFile };
