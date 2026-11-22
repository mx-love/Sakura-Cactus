import { randomBytes } from '@/features/auth/crypto.service';
import { getDb, nowIso } from '@/lib/db';
import type { TagRow } from '@/lib/database.types';
import {
  findTagByName,
  getPostTagReplacementStatements,
  listPublicPostsByTagSlug,
  listPublicTags,
  findFirstPublicPostDate,
  listPublicTagYearCounts,
  listLatestPublicPostsForTags,
  replacePostTags,
  tagSlugExists,
  createTag,
  listTagsForPost
} from './tag.repo';
import { decodeHtmlEntities } from '@/features/posts/post.renderer';
import { getSiteDateParts, getSiteMonthRange } from '@/lib/site-time';
import {
  TAG_ALPHABET_THRESHOLD,
  TAG_MOST_WRITTEN_LIMIT,
  buildMostWritten,
  groupTagsByInitial,
  selectVisibleTags,
  tagSeriesYears,
  type MostWrittenTag,
  type TagIndexGroup
} from './tag-index';
import { toPublicPostSummary, type PublicPostSummary } from '@/features/posts/post.types';

const TAG_SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const MAX_TAGS_PER_POST = 12;
const MAX_TAG_LENGTH = 40;

function randomTagSlug(): string {
  const bytes = randomBytes(8);
  let slug = 't-';

  for (const byte of bytes) {
    slug += TAG_SLUG_ALPHABET[byte % TAG_SLUG_ALPHABET.length];
  }

  return slug;
}

function slugifyTagName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48);
}

export function parseTagNames(value: unknown): string[] {
  if (value == null) {
    return [];
  }

  const raw = Array.isArray(value) ? value.join(',') : String(value);
  const names = raw
    .split(/[,，、\n\r\t ]+/)
    .map((tag) => tag.trim().replace(/^#+/, '').trim())
    .filter(Boolean)
    .map((tag) => tag.slice(0, MAX_TAG_LENGTH));

  return [...new Set(names)].slice(0, MAX_TAGS_PER_POST);
}

async function createUniqueTagSlug(db: D1Database, name: string): Promise<string> {
  const baseSlug = slugifyTagName(name);

  if (baseSlug && !(await tagSlugExists(db, baseSlug))) {
    return baseSlug;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = randomTagSlug();

    if (!(await tagSlugExists(db, slug))) {
      return slug;
    }
  }

  throw new Error('Unable to generate tag slug.');
}

export async function syncPostTags(db: D1Database, postId: string, tagNames: string[]): Promise<TagRow[]> {
  const { tags } = await preparePostTags(db, tagNames);

  await replacePostTags(db, postId, tags.map((tag) => tag.id));
  return tags;
}

export async function preparePostTags(db: D1Database, tagNames: string[]): Promise<{ tags: TagRow[]; tagIds: string[] }> {
  const tags: TagRow[] = [];

  for (const name of tagNames) {
    const existing = await findTagByName(db, name);
    const tag = existing ?? (await createTag(db, name, await createUniqueTagSlug(db, name)));
    tags.push(tag);
  }

  return { tags, tagIds: tags.map((tag) => tag.id) };
}

export function getPostTagSyncStatements(db: D1Database, postId: string, tagIds: string[]): D1PreparedStatement[] {
  return getPostTagReplacementStatements(db, postId, tagIds);
}

export async function getPostTags(db: D1Database, postId: string): Promise<TagRow[]> {
  return listTagsForPost(db, postId);
}

export async function getPublicTags() {
  return listPublicTags(getDb(), nowIso());
}

export async function getPublicPostsByTagSlug(slug: string): Promise<PublicPostSummary[]> {
  const posts = await listPublicPostsByTagSlug(getDb(), slug, nowIso());
  return posts.map((post) => toPublicPostSummary(post));
}

export interface PublicTagIndex {
  total: number;
  years: number[];
  mostWritten: MostWrittenTag[];
  groups: TagIndexGroup[];
  showAlphabet: boolean;
}

/**
 * Everything /tags renders, from four aggregate queries: visible tag counts,
 * the first public post date, and per-year counts plus the latest post for the
 * Most Written tags only. Small indexes skip the A–Z section and list every tag.
 */
export async function getPublicTagIndex(db: D1Database = getDb(), now = nowIso()): Promise<PublicTagIndex> {
  const tags = selectVisibleTags(await listPublicTags(db, now));
  if (tags.length === 0) return { total: 0, years: [], mostWritten: [], groups: [], showAlphabet: false };

  const showAlphabet = tags.length >= TAG_ALPHABET_THRESHOLD;
  const lead = showAlphabet ? tags.slice(0, TAG_MOST_WRITTEN_LIMIT) : tags;
  const leadIds = lead.map((tag) => tag.id);
  const firstPublished = await findFirstPublicPostDate(db, now);
  const years = tagSeriesYears(firstPublished ? getSiteDateParts(firstPublished).year : null, getSiteDateParts(now).year);
  // Each local year starts at the site-time-zone January 1st, expressed as a UTC instant.
  const yearStarts = years.map((year) => ({ year, start: getSiteMonthRange(Date.UTC(year, 0, 15)).monthStart }));
  const [yearCounts, latestPosts] = await Promise.all([
    listPublicTagYearCounts(db, leadIds, yearStarts, now),
    listLatestPublicPostsForTags(db, leadIds, now)
  ]);

  return {
    total: tags.length,
    years,
    mostWritten: buildMostWritten(lead, years, yearCounts, latestPosts).map((tag) => ({
      ...tag,
      latest: tag.latest ? { ...tag.latest, title: decodeHtmlEntities(tag.latest.title) } : null
    })),
    groups: showAlphabet ? groupTagsByInitial(tags) : [],
    showAlphabet
  };
}
