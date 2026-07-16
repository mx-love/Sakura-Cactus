const TEMPORARY_PAPER_TTL_MS = 24 * 60 * 60 * 1000;

export const TEMPORARY_PAPER_KEY = 'sakura-cactus:temporary-paper';
export const ABOUT_AUTOSAVE_KEY = 'sakura-cactus:writer:about';
export const POST_AUTOSAVE_KEY_PREFIX = 'sakura-cactus:writer:post:';
export const WRITER_AUTOSAVE_VERSION = 2;

export interface LegacyTemporaryPaper {
  postId?: string;
  title: string;
  slug: string;
  excerpt: string;
  contentMarkdown: string;
  tags: string;
  coverImage: string;
  updatedAt: string;
  expiresAt: string;
}

export interface WriterAutosaveSnapshot {
  version: number;
  draftKey: string;
  postId: string | null;
  slug: string;
  title: string;
  excerpt: string;
  contentMarkdown: string;
  tagInput: string;
  coverImage: string;
  updatedAt: number;
  expiresAt: number | null;
}

export interface WriterAutosaveReadResult {
  snapshot: WriterAutosaveSnapshot | null;
  error: 'parse' | 'invalid' | null;
  expired: boolean;
  source: 'current' | 'legacy' | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const timestamp = new Date(value).getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  return null;
}

function isLegacyTemporaryPaper(value: unknown): value is LegacyTemporaryPaper {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (typeof value.postId === 'string' || typeof value.postId === 'undefined') &&
    typeof value.title === 'string' &&
    typeof value.slug === 'string' &&
    typeof value.excerpt === 'string' &&
    typeof value.contentMarkdown === 'string' &&
    typeof value.tags === 'string' &&
    typeof value.coverImage === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.expiresAt === 'string'
  );
}

function isWriterAutosaveSnapshot(value: unknown): value is WriterAutosaveSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.version === 'number' &&
    typeof value.draftKey === 'string' &&
    (typeof value.postId === 'string' || value.postId === null) &&
    typeof value.slug === 'string' &&
    typeof value.title === 'string' &&
    typeof value.excerpt === 'string' &&
    typeof value.contentMarkdown === 'string' &&
    typeof value.tagInput === 'string' &&
    typeof value.coverImage === 'string' &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt) &&
    (typeof value.expiresAt === 'number' || value.expiresAt === null)
  );
}

function normalizeLegacyTemporaryPaper(value: LegacyTemporaryPaper): WriterAutosaveSnapshot | null {
  const updatedAt = parseTimestamp(value.updatedAt);
  const expiresAt = parseTimestamp(value.expiresAt);

  if (updatedAt === null || expiresAt === null) {
    return null;
  }

  return {
    version: WRITER_AUTOSAVE_VERSION,
    draftKey: TEMPORARY_PAPER_KEY,
    postId: value.postId ?? null,
    slug: value.slug,
    title: value.title,
    excerpt: value.excerpt,
    contentMarkdown: value.contentMarkdown,
    tagInput: value.tags,
    coverImage: value.coverImage,
    updatedAt,
    expiresAt
  };
}

export function getPostAutosaveKey(postId: string): string {
  return `${POST_AUTOSAVE_KEY_PREFIX}${postId}`;
}

export function getWriterAutosaveKey(postId: string | null, aboutMode = false): string {
  if (postId) {
    return getPostAutosaveKey(postId);
  }

  return aboutMode ? ABOUT_AUTOSAVE_KEY : TEMPORARY_PAPER_KEY;
}

export function buildWriterAutosaveSnapshot(input: {
  postId: string | null;
  slug: string;
  title: string;
  excerpt: string;
  contentMarkdown: string;
  tagInput: string;
  coverImage?: string | null;
  updatedAt?: number;
  aboutMode?: boolean;
}): WriterAutosaveSnapshot {
  const draftKey = getWriterAutosaveKey(input.postId, input.aboutMode);
  const updatedAt = input.updatedAt ?? Date.now();

  return {
    version: WRITER_AUTOSAVE_VERSION,
    draftKey,
    postId: input.postId,
    slug: input.slug,
    title: input.title,
    excerpt: input.excerpt,
    contentMarkdown: input.contentMarkdown,
    tagInput: input.tagInput,
    coverImage: input.coverImage ?? '',
    updatedAt,
    expiresAt: input.postId || input.aboutMode ? null : updatedAt + TEMPORARY_PAPER_TTL_MS
  };
}

export function hasMeaningfulWriterContent(snapshot: Pick<WriterAutosaveSnapshot, 'title' | 'excerpt' | 'contentMarkdown' | 'tagInput' | 'coverImage'>): boolean {
  return (
    snapshot.title.trim().length > 0 ||
    snapshot.excerpt.trim().length > 0 ||
    snapshot.contentMarkdown.trim().length > 0 ||
    snapshot.tagInput.trim().length > 0 ||
    snapshot.coverImage.trim().length > 0
  );
}

export function createWriterAutosaveComparable(snapshot: Pick<WriterAutosaveSnapshot, 'postId' | 'slug' | 'title' | 'excerpt' | 'contentMarkdown' | 'tagInput' | 'coverImage'>): string {
  return JSON.stringify({
    postId: snapshot.postId,
    slug: snapshot.slug,
    title: snapshot.title,
    excerpt: snapshot.excerpt,
    contentMarkdown: snapshot.contentMarkdown,
    tagInput: snapshot.tagInput,
    coverImage: snapshot.coverImage
  });
}

export function readWriterAutosaveSnapshot(storageKey: string): WriterAutosaveReadResult {
  try {
    const raw = window.localStorage.getItem(storageKey);

    if (!raw) {
      return {
        snapshot: null,
        error: null,
        expired: false,
        source: null
      };
    }

    const parsed = JSON.parse(raw) as unknown;

    if (isWriterAutosaveSnapshot(parsed)) {
      const expired = typeof parsed.expiresAt === 'number' && parsed.expiresAt <= Date.now();

      return {
        snapshot: expired ? null : parsed,
        error: null,
        expired,
        source: 'current'
      };
    }

    if (storageKey === TEMPORARY_PAPER_KEY && isLegacyTemporaryPaper(parsed)) {
      const normalized = normalizeLegacyTemporaryPaper(parsed);

      if (!normalized) {
        return {
          snapshot: null,
          error: 'invalid',
          expired: false,
          source: 'legacy'
        };
      }

      const expired = typeof normalized.expiresAt === 'number' && normalized.expiresAt <= Date.now();

      return {
        snapshot: expired ? null : normalized,
        error: null,
        expired,
        source: 'legacy'
      };
    }

    return {
      snapshot: null,
      error: 'invalid',
      expired: false,
      source: null
    };
  } catch {
    return {
      snapshot: null,
      error: 'parse',
      expired: false,
      source: null
    };
  }
}

export function writeWriterAutosaveSnapshot(storageKey: string, snapshot: WriterAutosaveSnapshot): boolean {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function clearWriterAutosaveSnapshot(storageKey: string): boolean {
  try {
    window.localStorage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}

export function formatWriterAutosaveTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
}
