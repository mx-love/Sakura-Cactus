import type { PostStatus, PostVisibility } from './post.types';

export class PostValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'PostValidationError';
  }
}

export const POST_STATUSES: PostStatus[] = ['draft', 'published', 'archived', 'deleted'];
export const POST_VISIBILITIES: PostVisibility[] = ['public', 'private'];

export interface NormalizedPostInput {
  title: string;
  excerpt: string | null;
  contentMarkdown: string;
  status: PostStatus;
  visibility: PostVisibility;
  publishedAt: string | null;
  tagNames: string[];
  seoTitle: string | null;
  seoDescription: string | null;
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new PostValidationError('INVALID_FIELD', 'Invalid post field.');
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, maxLength) : null;
}

function normalizePublishedAt(value: unknown): string | null {
  if (value == null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new PostValidationError('INVALID_PUBLISHED_AT', 'Invalid published time.');
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new PostValidationError('INVALID_PUBLISHED_AT', 'Invalid published time.');
  }

  return date.toISOString();
}

function parseTagNames(value: unknown): string[] {
  if (value == null) {
    return [];
  }

  const raw = Array.isArray(value) ? value.join(',') : String(value);
  const names = raw
    .split(/[,，、\n\r\t ]+/)
    .map((tag) => tag.trim().replace(/^#+/, '').trim())
    .filter(Boolean)
    .map((tag) => tag.slice(0, 40));

  return [...new Set(names)].slice(0, 12);
}

export function normalizePostInput(raw: unknown, defaultStatus: PostStatus): NormalizedPostInput {
  if (!raw || typeof raw !== 'object') {
    throw new PostValidationError('INVALID_POST', 'Invalid post payload.');
  }

  const body = raw as Record<string, unknown>;

  if (typeof body.title !== 'string' || body.title.trim().length === 0) {
    throw new PostValidationError('TITLE_REQUIRED', 'Title is required.');
  }

  if (typeof body.contentMarkdown !== 'string') {
    throw new PostValidationError('CONTENT_REQUIRED', 'Markdown content is required.');
  }

  const title = body.title.trim().slice(0, 200);
  const excerpt = normalizeOptionalText(body.excerpt, 500);
  const status = typeof body.status === 'string' ? (body.status as PostStatus) : defaultStatus;
  const visibility = typeof body.visibility === 'string' ? (body.visibility as PostVisibility) : 'public';

  if (!POST_STATUSES.includes(status) || status === 'deleted') {
    throw new PostValidationError('INVALID_STATUS', 'Invalid post status.');
  }

  if (!POST_VISIBILITIES.includes(visibility)) {
    throw new PostValidationError('INVALID_VISIBILITY', 'Invalid post visibility.');
  }

  return {
    title,
    excerpt,
    contentMarkdown: body.contentMarkdown.slice(0, 200_000),
    status,
    visibility,
    publishedAt: normalizePublishedAt(body.publishedAt ?? body.published_at),
    tagNames: parseTagNames(body.tags ?? body.tagNames),
    seoTitle: title,
    seoDescription: excerpt
  };
}
