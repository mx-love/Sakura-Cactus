import { useMemo, useRef, useState } from 'react';
import type { AssetRow } from '@/features/assets/asset.types';
import { renderMarkdown } from '@/features/posts/post.renderer';
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
  publishedAt: string;
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
    seoDescription: post?.seo_description ?? '',
    publishedAt: post?.published_at ?? ''
  };
}

function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-') || `post-${Date.now()}`
  );
}

function statusLabel(status: Exclude<PostStatus, 'deleted'>): string {
  if (status === 'published') {
    return '已发布';
  }

  if (status === 'archived') {
    return '已下架';
  }

  return '草稿';
}

function isImageUrl(value: string): boolean {
  const trimmed = value.trim();

  if (!/^https?:\/\//i.test(trimmed)) {
    return false;
  }

  try {
    const url = new URL(trimmed);
    return /\.(jpe?g|png|webp|gif)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function PostEditor({ post }: PostEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [form, setForm] = useState<PostFormState>(() => postToState(post));
  const [postId, setPostId] = useState(post?.id ?? null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [editorMode, setEditorMode] = useState<'edit' | 'preview' | 'split'>('edit');
  const isExisting = useMemo(() => Boolean(postId), [postId]);
  const previewHtml = useMemo(() => renderMarkdown(form.contentMarkdown), [form.contentMarkdown]);
  const isPublished = form.status === 'published';
  const isBusy = isSubmitting || isUploadingImage;
  const statusClass = form.status === 'published' ? 'sc-badge-published' : form.status === 'archived' ? 'sc-badge-archived' : 'sc-badge-draft';

  function updateField<K extends keyof PostFormState>(field: K, value: PostFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function readError(response: Response, fallback: string): Promise<string> {
    const payload = (await response.json().catch(() => null)) as ApiErrorResponse | null;
    return payload?.error.message ?? fallback;
  }

  function insertMarkdown(markdown: string) {
    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? form.contentMarkdown.length;
    const selectionEnd = textarea?.selectionEnd ?? form.contentMarkdown.length;
    const prefix = form.contentMarkdown.slice(0, selectionStart);
    const suffix = form.contentMarkdown.slice(selectionEnd);
    const spacerBefore = prefix.length > 0 && !prefix.endsWith('\n') ? '\n\n' : '';
    const spacerAfter = suffix.length > 0 && !suffix.startsWith('\n') ? '\n\n' : '';
    const insertion = `${spacerBefore}${markdown}${spacerAfter}`;

    updateField('contentMarkdown', `${prefix}${insertion}${suffix}`);

    window.requestAnimationFrame(() => {
      textarea?.focus();
      const cursor = selectionStart + insertion.length;
      textarea?.setSelectionRange(cursor, cursor);
    });
  }

  async function uploadImageFile(file: File) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/admin/assets/upload', {
      method: 'POST',
      credentials: 'same-origin',
      body: formData
    });

    if (!response.ok) {
      throw new Error(await readError(response, 'Unable to upload image.'));
    }

    const payload = (await response.json()) as { ok: true; data: { asset: AssetRow; url: string } };
    return payload.data.asset;
  }

  async function uploadAndInsertImages(files: File[]) {
    const images = files.filter((file) => file.type.startsWith('image/'));

    if (images.length === 0) {
      return;
    }

    setError(null);
    setMessage(null);
    setIsUploadingImage(true);

    try {
      const snippets: string[] = [];

      for (const image of images) {
        const asset = await uploadImageFile(image);
        snippets.push(`![图片说明](asset:${asset.token})`);
      }

      insertMarkdown(snippets.join('\n\n'));
      setMessage(images.length > 1 ? 'Images inserted.' : 'Image inserted.');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload image.');
    } finally {
      setIsUploadingImage(false);
    }
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (files.length > 0) {
      event.preventDefault();
      await uploadAndInsertImages(files);
      return;
    }

    const text = event.clipboardData.getData('text/plain');

    if (isImageUrl(text)) {
      event.preventDefault();
      insertMarkdown(`![图片说明](${text.trim()})`);
    }
  }

  async function handleDrop(event: React.DragEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'));

    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    await uploadAndInsertImages(files);
  }

  function generateSlug() {
    updateField('slug', slugifyTitle(form.title));
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
          seoTitle: form.title,
          seoDescription: form.excerpt
        })
      });

      if (!response.ok) {
        setError(await readError(response, 'Unable to save post.'));
        return;
      }

      const payload = (await response.json()) as { ok: true; data: { post: PostRow } };
      setPostId(payload.data.post.id);
      setForm(postToState(payload.data.post));
      setMessage(status === 'published' ? '已发布' : '已保存');

      if (!postId) {
        window.history.replaceState(null, '', '/write');
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
      setMessage('已下架');
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

      window.location.assign('/articles');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={(event) => event.preventDefault()}>
      <div className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[rgba(255,253,253,0.9)] py-3 backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <a className="text-sm font-bold text-[var(--color-primary)] hover:underline" href="/articles">
            ← 返回文章
          </a>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`sc-badge ${statusClass}`}>{message ?? (error ? '保存失败' : statusLabel(form.status))}</span>
            <button
              className="sc-button sc-button-secondary sc-button-small disabled:opacity-60"
              disabled={isBusy}
              onClick={() => saveWithStatus('draft')}
              type="button"
            >
              保存草稿
            </button>
            <button
              className="sc-button sc-button-primary sc-button-small disabled:opacity-60"
              disabled={isBusy}
              onClick={() => saveWithStatus('published')}
              type="button"
            >
              {isPublished ? '更新' : '发布'}
            </button>
            {isPublished ? (
              <button
                className="sc-button sc-button-secondary sc-button-small disabled:opacity-60"
                disabled={isSubmitting || !isExisting}
                onClick={unpublish}
                type="button"
              >
                下架
              </button>
            ) : null}
          </div>
        </div>
        {error ? <p className="sc-field-error mt-2">{error}</p> : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-5">
        <div className="border-b border-[var(--color-border)] pb-5">
          <input
            aria-label="Post title"
            className="w-full border-0 bg-transparent text-4xl font-extrabold leading-tight outline-none placeholder:text-[var(--color-subtle)] sm:text-5xl"
            placeholder="Untitled post"
            value={form.title}
            onChange={(event) => updateField('title', event.target.value)}
            required
          />
          <textarea
            aria-label="Post excerpt"
            className="mt-5 min-h-24 w-full resize-y border-0 bg-transparent text-lg leading-8 text-[var(--color-muted)] outline-none placeholder:text-[var(--color-subtle)]"
            placeholder="Write a short subtitle or summary..."
            value={form.excerpt}
            onChange={(event) => updateField('excerpt', event.target.value)}
          />
        </div>

        <div className="rounded-md border border-[var(--color-border)] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-2">
            <div className="flex gap-1">
              <button
                className={`rounded-md px-3 py-1.5 text-sm font-bold transition ${editorMode === 'edit' ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}
                onClick={() => setEditorMode('edit')}
                type="button"
              >
                Edit
              </button>
              <button
                className={`rounded-md px-3 py-1.5 text-sm font-bold transition ${editorMode === 'preview' ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}
                onClick={() => setEditorMode('preview')}
                type="button"
              >
                Preview
              </button>
              <button
                className={`rounded-md px-3 py-1.5 text-sm font-bold transition ${editorMode === 'split' ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}
                onClick={() => setEditorMode('split')}
                type="button"
              >
                Split
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isUploadingImage ? <span className="sc-badge">上传中</span> : null}
            </div>
          </div>

          {editorMode === 'edit' || editorMode === 'split' ? (
            <div className={editorMode === 'split' ? 'grid lg:grid-cols-2' : ''}>
            <textarea
              ref={textareaRef}
              className="min-h-[620px] w-full resize-y border-0 bg-white px-4 py-4 font-mono text-sm leading-8 outline-none placeholder:text-[var(--color-muted)]"
              placeholder="Write Markdown here. Paste or drop images to upload."
              value={form.contentMarkdown}
              onChange={(event) => updateField('contentMarkdown', event.target.value)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
              onPaste={handlePaste}
              required
            />
            {editorMode === 'split' ? (
              <div className="sc-prose prose-content min-h-[620px] border-t border-[var(--color-border)] px-4 py-4 lg:border-l lg:border-t-0" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            ) : null}
            </div>
          ) : (
            <div className="sc-prose prose-content min-h-[620px] bg-white px-4 py-4" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          )}
        </div>

      </div>

      <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
        <div className="rounded-md border border-[var(--color-border)] bg-white p-4">
          <h2 className="text-sm font-bold">文章设置</h2>

          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <span className="block text-xs font-semibold uppercase text-[var(--color-muted)]">可见性</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={`rounded-2xl border px-3 py-2 text-sm font-black ${form.visibility === 'public' ? 'border-[var(--color-text)] bg-[var(--color-text)] text-white' : 'border-[var(--color-border)] bg-white text-[var(--color-text)]'}`}
                  onClick={() => updateField('visibility', 'public')}
                  type="button"
                >
                  公开
                </button>
                <button
                  className={`rounded-2xl border px-3 py-2 text-sm font-black ${form.visibility === 'private' ? 'border-[var(--color-text)] bg-[var(--color-text)] text-white' : 'border-[var(--color-border)] bg-white text-[var(--color-text)]'}`}
                  onClick={() => updateField('visibility', 'private')}
                  type="button"
                >
                  仅自己
                </button>
              </div>
            </div>

            <label className="space-y-2">
              <span className="block text-xs font-semibold uppercase text-[var(--color-muted)]">Slug</span>
              <div className="flex gap-2">
                <input
                  className="sc-input min-w-0 flex-1 text-sm"
                  value={form.slug}
                  onChange={(event) => updateField('slug', event.target.value)}
                  placeholder="auto-generated-from-title"
                />
                <button
                  className="sc-button sc-button-secondary sc-button-small"
                  onClick={generateSlug}
                  type="button"
                >
                  Auto
                </button>
              </div>
            </label>

            <p className="text-xs leading-5 text-[var(--color-muted)]">
              公开发布后会显示在文章列表。
            </p>
          </div>
        </div>

        {isExisting ? (
          <div className="rounded-[24px] border border-[var(--color-danger-soft)] bg-white/62 p-4">
            <h2 className="text-sm font-bold text-[var(--color-danger)]">危险区域</h2>
            <button
              className="sc-button sc-button-danger mt-3 w-full disabled:opacity-60"
              disabled={isSubmitting}
              onClick={deletePost}
              type="button"
            >
              删除文章
            </button>
          </div>
        ) : null}
      </aside>
      </div>
    </form>
  );
}
