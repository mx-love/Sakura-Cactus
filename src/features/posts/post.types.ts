import type { PostRow, PostStatus, PostVisibility } from '@/lib/database.types';
import { extractFirstImageUrl } from './post.renderer';

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
  includeDeleted?: boolean;
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
}

export function toPublicPostSummary(post: PostRow, tags: PublicPostTag[] = []): PublicPostSummary {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    coverImageUrl: extractFirstImageUrl(post.content_markdown),
    tags: tags.map((tag) => ({ name: tag.name, slug: tag.slug })),
    publishedAt: post.published_at,
    pinnedAt: post.pinned_at,
    updatedAt: post.updated_at
  };
}

export function toPublicPostDetail(post: PostRow, tags: PublicPostTag[] = []): PublicPostDetail {
  return {
    ...toPublicPostSummary(post, tags),
    contentHtml: post.content_html ?? '',
    seoTitle: post.seo_title,
    seoDescription: post.seo_description
  };
}
