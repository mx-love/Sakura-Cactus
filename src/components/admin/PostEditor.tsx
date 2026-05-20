import { useMemo, useState } from 'react';
import type { PostRow, PostStatus, PostVisibility } from '@/features/posts/post.types';

interface ApiErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

interface PostEditorProps {
  post?: PostRow | null;
}

type PostFormState = {
  title: string;
  slug: string;
  excerpt: string;
  contentMarkdown: string;
  status: Exclude<PostStatus, 'deleted'>;
  visibility: PostVisibility;
  seoTitle: string;
  seoDescription: string;
};

function postToState(post?: PostRow | null): PostFormState {
  return {
    title: post?.title ?? '',
    slug: post?.slug ?? '',
    excerpt: post?.excerpt ?? '',
    contentMarkdown: post?.content_markdown ?? '',
    status: post?.status === 'deleted' ? 'draft' : (post?.status ?? 'draft'),
    visibility: post?.visibility ?? 'public',
    seoTitle: post?.seo_title ?? '',
    seoDescription: post?.seo_description ?? ''
  };
}

export function PostEditor({ post }: PostEditorProps) {
  const [form, setForm] = useState<PostFormState>(() => postToState(post));
  const [postId, setPostId] = useState(post?.id ?? null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isExisting = useMemo(() => Boolean(postId), [postId]);

  function updateField<K extends keyof PostFormState>(field: K, value: PostFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function readError(response: Response, fallback: string): Promise<string> {
    const payload = (await response.json().catch(() => null)) as ApiErrorResponse | null;
    return payload?.error.message ?? fallback;
  }

  async function saveWithStatus(status: Exclude<PostStatus, 'deleted'>) {
    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    try {
      const endpoint = postId ? `/api/admin/posts/${postId}` : '/api/admin/posts';
      const response = await fetch(endpoint, {
        method: postId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          title: form.title,
          slug: form.slug,
          excerpt: form.excerpt,
          contentMarkdown: form.contentMarkdown,
          status,
          visibility: form.visibility,
          seoTitle: form.seoTitle,
          seoDescription: form.seoDescription
        })
      });

      if (!response.ok) {
        setError(await readError(response, 'Unable to save post.'));
        return;
      }

      const payload = (await response.json()) as { ok: true; data: { post: PostRow } };
      setPostId(payload.data.post.id);
      setForm(postToState(payload.data.post));
      setMessage(status === 'published' ? 'Published.' : 'Saved.');

      if (!postId) {
        window.history.replaceState(null, '', `/admin/posts/${payload.data.post.id}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function unpublish() {
    if (!postId) {
      setError('Save the post before unpublishing.');
      return;
    }

    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/posts/${postId}/unpublish`, {
        method: 'POST',
        credentials: 'same-origin'
      });

      if (!response.ok) {
        setError(await readError(response, 'Unable to unpublish post.'));
        return;
      }

      const payload = (await response.json()) as { ok: true; data: { post: PostRow } };
      setForm(postToState(payload.data.post));
      setMessage('Unpublished.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function deletePost() {
    if (!postId) {
      setError('Save the post before deleting.');
      return;
    }

    if (!window.confirm('Delete this post? This will remove it from the public site.')) {
      return;
    }

    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/posts/${postId}`, {
        method: 'DELETE',
        credentials: 'same-origin'
      });

      if (!response.ok) {
        setError(await readError(response, 'Unable to delete post.'));
        return;
      }

      window.location.assign('/admin/posts');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={(event) => event.preventDefault()}>
      <div className="grid gap-5 md:grid-cols-2">
        <label className="space-y-2">
          <span className="block text-sm font-medium">Title</span>
          <input
            className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 outline-none focus:border-[var(--color-primary)]"
            value={form.title}
            onChange={(event) => updateField('title', event.target.value)}
            required
          />
        </label>

        <label className="space-y-2">
          <span className="block text-sm font-medium">Slug</span>
          <input
            className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 outline-none focus:border-[var(--color-primary)]"
            value={form.slug}
            onChange={(event) => updateField('slug', event.target.value)}
            placeholder="auto-generated-from-title"
          />
        </label>
      </div>

      <label className="space-y-2">
        <span className="block text-sm font-medium">Excerpt</span>
        <textarea
          className="min-h-24 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 outline-none focus:border-[var(--color-primary)]"
          value={form.excerpt}
          onChange={(event) => updateField('excerpt', event.target.value)}
        />
      </label>

      <label className="space-y-2">
        <span className="block text-sm font-medium">Markdown</span>
        <textarea
          className="min-h-96 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 font-mono text-sm leading-6 outline-none focus:border-[var(--color-primary)]"
          value={form.contentMarkdown}
          onChange={(event) => updateField('contentMarkdown', event.target.value)}
          required
        />
      </label>

      <div className="grid gap-5 md:grid-cols-2">
        <label className="space-y-2">
          <span className="block text-sm font-medium">Status</span>
          <select
            className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 outline-none focus:border-[var(--color-primary)]"
            value={form.status}
            onChange={(event) => updateField('status', event.target.value as Exclude<PostStatus, 'deleted'>)}
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </label>

        <label className="space-y-2">
          <span className="block text-sm font-medium">Visibility</span>
          <select
            className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 outline-none focus:border-[var(--color-primary)]"
            value={form.visibility}
            onChange={(event) => updateField('visibility', event.target.value as PostVisibility)}
          >
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </label>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <label className="space-y-2">
          <span className="block text-sm font-medium">SEO Title</span>
          <input
            className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 outline-none focus:border-[var(--color-primary)]"
            value={form.seoTitle}
            onChange={(event) => updateField('seoTitle', event.target.value)}
          />
        </label>

        <label className="space-y-2">
          <span className="block text-sm font-medium">SEO Description</span>
          <input
            className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 outline-none focus:border-[var(--color-primary)]"
            value={form.seoDescription}
            onChange={(event) => updateField('seoDescription', event.target.value)}
          />
        </label>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-green-700">{message}</p> : null}

      <div className="flex flex-wrap gap-3">
        <button
          className="rounded-lg bg-[var(--color-text)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          disabled={isSubmitting}
          onClick={() => saveWithStatus('draft')}
          type="button"
        >
          Save draft
        </button>
        <button
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-text)] disabled:opacity-60"
          disabled={isSubmitting}
          onClick={() => saveWithStatus('published')}
          type="button"
        >
          Publish
        </button>
        <button
          className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-text)] disabled:opacity-60"
          disabled={isSubmitting || !isExisting}
          onClick={unpublish}
          type="button"
        >
          Unpublish
        </button>
        <button
          className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-60"
          disabled={isSubmitting || !isExisting}
          onClick={deletePost}
          type="button"
        >
          Delete
        </button>
        <a
          className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-text)]"
          href="/admin/posts"
        >
          Back to posts
        </a>
      </div>
    </form>
  );
}
