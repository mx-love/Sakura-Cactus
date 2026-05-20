import type { PostRow, PostStatus, PostVisibility } from '@/lib/database.types';

export type { PostRow, PostStatus, PostVisibility };

export interface PostInput {
  title: string;
  slug?: string | null;
  excerpt?: string | null;
  contentMarkdown: string;
  status?: PostStatus;
  visibility?: PostVisibility;
  seoTitle?: string | null;
  seoDescription?: string | null;
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
  publishedAt: string | null;
  updatedAt: string;
}

export interface PublicPostDetail extends PublicPostSummary {
  contentHtml: string;
  seoTitle: string | null;
  seoDescription: string | null;
}

export function toPublicPostSummary(post: PostRow): PublicPostSummary {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    publishedAt: post.published_at,
    updatedAt: post.updated_at
  };
}

export function toPublicPostDetail(post: PostRow): PublicPostDetail {
  return {
    ...toPublicPostSummary(post),
    contentHtml: post.content_html ?? '',
    seoTitle: post.seo_title,
    seoDescription: post.seo_description
  };
}
