import type { PublicTagLatestPostRow, PublicTagSummary, PublicTagYearCountRow } from './tag.repo';

/*
 * Pure helpers behind the public subject index (/tags): one table of every
 * visible tag with yearly bars and its latest post.
 */

/** Keep the yearly bars readable on very old archives. */
export const TAG_YEAR_SERIES_MAX = 12;

export interface TagIndexEntry {
  id: string;
  name: string;
  slug: string;
  postCount: number;
}

export interface TagYearBar {
  year: number;
  count: number;
}

export interface SubjectRow extends TagIndexEntry {
  years: TagYearBar[];
  latest: { slug: string; title: string; publishedAt: string } | null;
}

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

/** Years shown in the yearly bars: first public post year to the current year, capped to the latest few. */
export function tagSeriesYears(firstYear: number | null, currentYear: number, max = TAG_YEAR_SERIES_MAX): number[] {
  if (!Number.isInteger(currentYear)) return [];
  const start = Math.max(Number.isInteger(firstYear) ? Math.min(firstYear!, currentYear) : currentYear, currentYear - max + 1);
  return Array.from({ length: currentYear - start + 1 }, (_, index) => start + index);
}

/** Joins the aggregate rows into the subject table, keeping zero years as explicit bars. */
export function buildSubjectRows(
  tags: TagIndexEntry[],
  years: number[],
  yearCounts: PublicTagYearCountRow[],
  latestPosts: PublicTagLatestPostRow[]
): SubjectRow[] {
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
