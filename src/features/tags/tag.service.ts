import { randomBytes } from '@/features/auth/crypto.service';
import { getDb, nowIso } from '@/lib/db';
import type { TagRow } from '@/lib/database.types';
import { findTagByName, listPublicPostsByTagSlug, listPublicTags, replacePostTags, tagSlugExists, createTag, listTagsForPost } from './tag.repo';
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
  const tags: TagRow[] = [];

  for (const name of tagNames) {
    const existing = await findTagByName(db, name);
    const tag = existing ?? (await createTag(db, name, await createUniqueTagSlug(db, name)));
    tags.push(tag);
  }

  await replacePostTags(db, postId, tags.map((tag) => tag.id));
  return tags;
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
