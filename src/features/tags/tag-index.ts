import { pinyin } from 'pinyin-pro';
import type { PublicTagLatestPostRow, PublicTagSummary, PublicTagYearCountRow } from './tag.repo';

/*
 * Pure helpers behind the public subject index (/tags). They run on the server
 * only; pinyin-pro is never shipped to the browser.
 */

export const TAG_INDEX_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const TAG_INDEX_OTHER = '#';
/** Below this many visible tags the A–Z section is hidden and the table lists every tag. */
export const TAG_ALPHABET_THRESHOLD = 15;
export const TAG_MOST_WRITTEN_LIMIT = 8;
/** Keep the yearly bars readable on very old archives. */
export const TAG_YEAR_SERIES_MAX = 12;

export interface TagIndexEntry {
  id: string;
  name: string;
  slug: string;
  postCount: number;
}

export interface TagIndexGroup {
  letter: string;
  tags: TagIndexEntry[];
}

export interface TagYearBar {
  year: number;
  count: number;
}

export interface MostWrittenTag extends TagIndexEntry {
  years: TagYearBar[];
  latest: { slug: string; title: string; publishedAt: string } | null;
}

const HAN = /\p{Script=Han}/u;
const ASCII_LETTER = /^[A-Za-z]$/;

/**
 * Only tags with at least one public, published post are visible anywhere on
 * /tags. The SQL already joins through public posts; this also drops any row
 * whose count is not positive, then orders by post count and a stable name.
 */
export function selectVisibleTags(rows: Array<Pick<PublicTagSummary, 'id' | 'name' | 'slug' | 'post_count'>>): TagIndexEntry[] {
  return rows
    .map((row) => ({ id: row.id, name: row.name, slug: row.slug, postCount: Number(row.post_count) || 0 }))
    .filter((tag) => tag.postCount > 0 && tag.name.trim() !== '')
    .sort((a, b) => b.postCount - a.postCount || a.name.localeCompare(b.name, 'zh-CN'));
}

/** Index letter for a tag: pinyin initial for Chinese, first letter for ASCII, otherwise "#". */
export function tagIndexInitial(name: string): string {
  const first = [...name.trim()][0] ?? '';
  if (ASCII_LETTER.test(first)) return first.toUpperCase();
  if (HAN.test(first)) {
    const initial = pinyin(first, { pattern: 'first', toneType: 'none', type: 'array' })[0]?.toUpperCase() ?? '';
    if (TAG_INDEX_LETTERS.includes(initial)) return initial;
  }
  return TAG_INDEX_OTHER;
}

/** Sort key that orders Chinese by pinyin and ASCII case-insensitively in one sequence. */
export function tagSortKey(name: string): string {
  return pinyin(name.trim(), { toneType: 'none', type: 'array', nonZh: 'consecutive' })
    .join(' ')
    .toLowerCase();
}

/** Groups tags under A–Z (then "#"), each group sorted by pinyin. */
export function groupTagsByInitial(tags: TagIndexEntry[]): TagIndexGroup[] {
  const groups = new Map<string, Array<{ tag: TagIndexEntry; key: string }>>();
  for (const tag of tags) {
    const letter = tagIndexInitial(tag.name);
    const group = groups.get(letter) ?? [];
    group.push({ tag, key: tagSortKey(tag.name) });
    groups.set(letter, group);
  }
  return [...TAG_INDEX_LETTERS, TAG_INDEX_OTHER]
    .filter((letter) => groups.has(letter))
    .map((letter) => ({
      letter,
      tags: groups
        .get(letter)!
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.tag.name.localeCompare(b.tag.name, 'zh-CN')))
        .map(({ tag }) => tag)
    }));
}

/** Years shown in the yearly bars: first public post year to the current year, capped to the latest few. */
export function tagSeriesYears(firstYear: number | null, currentYear: number, max = TAG_YEAR_SERIES_MAX): number[] {
  if (!Number.isInteger(currentYear)) return [];
  const start = Math.max(Number.isInteger(firstYear) ? Math.min(firstYear!, currentYear) : currentYear, currentYear - max + 1);
  return Array.from({ length: currentYear - start + 1 }, (_, index) => start + index);
}

/** Joins the aggregate rows into the Most Written table, keeping zero years as explicit bars. */
export function buildMostWritten(
  tags: TagIndexEntry[],
  years: number[],
  yearCounts: PublicTagYearCountRow[],
  latestPosts: PublicTagLatestPostRow[]
): MostWrittenTag[] {
  const counts = new Map<string, number>();
  for (const row of yearCounts) counts.set(`${row.tag_id}:${Number(row.year)}`, Number(row.post_count) || 0);
  const latest = new Map(latestPosts.map((row) => [row.tag_id, row]));
  return tags.map((tag) => {
    const post = latest.get(tag.id);
    return {
      ...tag,
      years: years.map((year) => ({ year, count: counts.get(`${tag.id}:${year}`) ?? 0 })),
      latest: post ? { slug: post.slug, title: post.title, publishedAt: post.published_at } : null
    };
  });
}
