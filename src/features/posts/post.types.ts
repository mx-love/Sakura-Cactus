import type { PostRow, PostStatus, PostVisibility } from '@/lib/database.types';
import { decodeHtmlEntities, extractFirstImageUrl, renderMarkdown } from './post.renderer';

export type { PostRow, PostStatus, PostVisibility };

export interface PublicPostTag {
  name: string;
  slug: string;
}

export interface PostInput {
  title: string;
  excerpt?: string | null;
  contentMarkdown: string;
  status?: PostStatus;
  visibility?: PostVisibility;
  publishedAt?: string | null;
  tags?: string[] | string | null;
}

export interface CreatePostInput extends PostInput {
  status?: PostStatus;
}

export interface UpdatePostInput extends PostInput {
  status: PostStatus;
}

export interface PostListFilters {
  status?: PostStatus;
  visibility?: PostVisibility;
}

export interface PublicPostSummary {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  tags: PublicPostTag[];
  publishedAt: string | null;
  pinnedAt: string | null;
  updatedAt: string;
}

export interface PublicPostDetail extends PublicPostSummary {
  contentHtml: string;
  seoTitle: string | null;
  seoDescription: string | null;
  status: PostStatus;
  visibility: PostVisibility;
}

export function toPublicPostSummary(post: PostRow, tags: PublicPostTag[] = []): PublicPostSummary {
  return {
    id: post.id,
    slug: post.slug,
    title: decodeHtmlEntities(post.title),
    excerpt: post.excerpt ? decodeHtmlEntities(post.excerpt) : null,
    coverImageUrl: extractFirstImageUrl(post.content_markdown),
    tags: tags.map((tag) => ({ name: decodeHtmlEntities(tag.name), slug: tag.slug })),
    publishedAt: post.published_at,
    pinnedAt: post.pinned_at,
    updatedAt: post.updated_at
  };
}

export function toPublicPostDetail(post: PostRow, tags: PublicPostTag[] = []): PublicPostDetail {
  return {
    ...toPublicPostSummary(post, tags),
    // Re-render from Markdown on read so legacy/stale stored HTML always uses the current sanitizer policy.
    contentHtml: renderMarkdown(post.content_markdown),
    seoTitle: post.seo_title ? decodeHtmlEntities(post.seo_title) : null,
    seoDescription: post.seo_description ? decodeHtmlEntities(post.seo_description) : null,
    status: post.status,
    visibility: post.visibility
  };
}
