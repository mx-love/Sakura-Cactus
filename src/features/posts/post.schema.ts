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

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface NormalizedPostInput {
  title: string;
  slug: string;
  excerpt: string | null;
  contentMarkdown: string;
  status: PostStatus;
  visibility: PostVisibility;
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

export function slugifyTitle(title: string): string {
  const normalized = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return normalized || `post-${Date.now()}`;
}

export function assertValidSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new PostValidationError(
      'INVALID_SLUG',
      'Slug can only contain lowercase letters, numbers, and hyphens.'
    );
  }
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
  const requestedSlug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const slug = requestedSlug.length > 0 ? requestedSlug : slugifyTitle(title);
  const status = typeof body.status === 'string' ? (body.status as PostStatus) : defaultStatus;
  const visibility = typeof body.visibility === 'string' ? (body.visibility as PostVisibility) : 'public';

  if (!POST_STATUSES.includes(status) || status === 'deleted') {
    throw new PostValidationError('INVALID_STATUS', 'Invalid post status.');
  }

  if (!POST_VISIBILITIES.includes(visibility)) {
    throw new PostValidationError('INVALID_VISIBILITY', 'Invalid post visibility.');
  }

  assertValidSlug(slug);

  return {
    title,
    slug,
    excerpt: normalizeOptionalText(body.excerpt, 500),
    contentMarkdown: body.contentMarkdown.slice(0, 200_000),
    status,
    visibility,
    seoTitle: normalizeOptionalText(body.seoTitle ?? body.seo_title, 200),
    seoDescription: normalizeOptionalText(body.seoDescription ?? body.seo_description, 300)
  };
}
