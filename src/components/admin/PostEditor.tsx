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

function extractInsertedImageTokens(markdown: string): string[] {
  const tokens = new Set<string>();
  const pattern = /!\[[^\]]*]\(\s*asset:([A-Za-z0-9_-]{24,64})\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markdown)) !== null) {
    tokens.add(match[1]);
  }

  return [...tokens];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    return 'Published';
  }

  if (status === 'archived') {
    return 'Unpublished';
  }

  return 'Draft';
}

export function PostEditor({ post }: PostEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [form, setForm] = useState<PostFormState>(() => postToState(post));
  const [postId, setPostId] = useState(post?.id ?? null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [editorMode, setEditorMode] = useState<'edit' | 'preview'>('edit');
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const isExisting = useMemo(() => Boolean(postId), [postId]);
  const insertedImageTokens = useMemo(() => extractInsertedImageTokens(form.contentMarkdown), [form.contentMarkdown]);
  const previewHtml = useMemo(() => renderMarkdown(form.contentMarkdown), [form.contentMarkdown]);
  const isPublished = form.status === 'published';
  const isBusy = isSubmitting || isUploadingImage;

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

    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    await uploadAndInsertImages(files);
  }

  async function handleDrop(event: React.DragEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'));

    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    await uploadAndInsertImages(files);
  }

  async function openGallery() {
    setIsGalleryOpen((current) => !current);

    if (assets.length > 0 || isGalleryOpen) {
      return;
    }

    setIsLoadingAssets(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/assets', {
        credentials: 'same-origin'
      });

      if (!response.ok) {
        setError(await readError(response, 'Unable to load images.'));
        return;
      }

      const payload = (await response.json()) as { ok: true; data: { assets: AssetRow[] } };
      setAssets(payload.data.assets);
    } finally {
      setIsLoadingAssets(false);
    }
  }

  function removeInsertedImage(token: string) {
    const pattern = new RegExp(`!?\\[[^\\]]*]\\(\\s*asset:${escapeRegExp(token)}\\s*\\)\\n*`, 'g');
    updateField('contentMarkdown', form.contentMarkdown.replace(pattern, '').trim());
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
    <form className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]" onSubmit={(event) => event.preventDefault()}>
      <div className="space-y-5">
        <div className="rounded-lg border border-[var(--color-border)] bg-white/85 p-5 shadow-sm">
          <input
            aria-label="Post title"
            className="w-full border-0 bg-transparent text-3xl font-semibold leading-tight outline-none placeholder:text-[var(--color-muted)] sm:text-4xl"
            placeholder="Untitled post"
            value={form.title}
            onChange={(event) => updateField('title', event.target.value)}
            required
          />
          <textarea
            aria-label="Post excerpt"
            className="mt-4 min-h-20 w-full resize-y border-0 bg-transparent text-base leading-7 text-[var(--color-muted)] outline-none placeholder:text-[var(--color-muted)]"
            placeholder="Write a short subtitle or summary..."
            value={form.excerpt}
            onChange={(event) => updateField('excerpt', event.target.value)}
          />
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-white/85 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
            <div className="flex rounded-lg border border-[var(--color-border)] bg-white p-1">
              <button
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${editorMode === 'edit' ? 'bg-[var(--color-text)] text-white' : 'text-[var(--color-muted)]'}`}
                onClick={() => setEditorMode('edit')}
                type="button"
              >
                Edit
              </button>
              <button
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${editorMode === 'preview' ? 'bg-[var(--color-text)] text-white' : 'text-[var(--color-muted)]'}`}
                onClick={() => setEditorMode('preview')}
                type="button"
              >
                Preview
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm font-semibold text-[var(--color-text)]"
                onClick={openGallery}
                type="button"
              >
                Insert image
              </button>
              {isUploadingImage ? <span className="text-xs text-[var(--color-muted)]">Uploading image...</span> : null}
            </div>
          </div>

          {editorMode === 'edit' ? (
            <textarea
              ref={textareaRef}
              className="min-h-[560px] w-full resize-y border-0 bg-white/70 px-5 py-4 font-mono text-sm leading-7 outline-none placeholder:text-[var(--color-muted)]"
              placeholder="Write Markdown here. Paste or drop images to upload."
              value={form.contentMarkdown}
              onChange={(event) => updateField('contentMarkdown', event.target.value)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
              onPaste={handlePaste}
              required
            />
          ) : (
            <div className="prose-content min-h-[560px] bg-white/70 px-5 py-4" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          )}
        </div>

        {isGalleryOpen ? (
          <div className="rounded-lg border border-[var(--color-border)] bg-white/85 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Insert from gallery</h2>
              {isLoadingAssets ? <span className="text-xs text-[var(--color-muted)]">Loading...</span> : null}
            </div>
            {assets.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">No images available.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {assets.map((asset) => (
                  <button
                    className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-white text-left transition hover:border-[var(--color-primary)]"
                    key={asset.id}
                    onClick={() => insertMarkdown(`![图片说明](asset:${asset.token})`)}
                    type="button"
                  >
                    <img
                      alt={asset.original_filename ?? asset.id}
                      className="aspect-[4/3] w-full object-cover"
                      loading="lazy"
                      src={`/i/${asset.token}`}
                    />
                    <span className="block truncate px-2 py-2 text-xs text-[var(--color-muted)]">
                      {asset.original_filename ?? asset.token}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-lg border border-[var(--color-border)] bg-white/85 p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">Status</span>
            <span className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1 text-xs font-semibold text-[var(--color-muted)]">
              {statusLabel(form.status)}
            </span>
          </div>

          {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
          {message ? <p className="mt-3 text-sm text-green-700">{message}</p> : null}

          <div className="mt-4 flex flex-col gap-2">
            {isPublished ? (
              <>
                <button
                  className="rounded-lg bg-[var(--color-text)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={isBusy}
                  onClick={() => saveWithStatus('published')}
                  type="button"
                >
                  Update
                </button>
                <button
                  className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-text)] disabled:opacity-60"
                  disabled={isSubmitting || !isExisting}
                  onClick={unpublish}
                  type="button"
                >
                  Unpublish
                </button>
              </>
            ) : (
              <>
                <button
                  className="rounded-lg bg-[var(--color-text)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={isBusy}
                  onClick={() => saveWithStatus('draft')}
                  type="button"
                >
                  Save draft
                </button>
                <button
                  className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-text)] disabled:opacity-60"
                  disabled={isBusy}
                  onClick={() => saveWithStatus('published')}
                  type="button"
                >
                  Publish
                </button>
              </>
            )}

            {isExisting ? (
              <button
                className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-60"
                disabled={isSubmitting}
                onClick={deletePost}
                type="button"
              >
                Delete
              </button>
            ) : null}

            <a
              className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-center text-sm font-semibold text-[var(--color-text)]"
              href="/admin/posts"
            >
              Back to posts
            </a>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-white/85 p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Article settings</h2>

          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <span className="block text-xs font-semibold uppercase text-[var(--color-muted)]">Visibility</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold ${form.visibility === 'public' ? 'border-[var(--color-text)] bg-[var(--color-text)] text-white' : 'border-[var(--color-border)] bg-white text-[var(--color-text)]'}`}
                  onClick={() => updateField('visibility', 'public')}
                  type="button"
                >
                  Public
                </button>
                <button
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold ${form.visibility === 'private' ? 'border-[var(--color-text)] bg-[var(--color-text)] text-white' : 'border-[var(--color-border)] bg-white text-[var(--color-text)]'}`}
                  onClick={() => updateField('visibility', 'private')}
                  type="button"
                >
                  Private
                </button>
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2">
              <input
                checked={form.visibility === 'public'}
                className="mt-1"
                onChange={(event) => updateField('visibility', event.target.checked ? 'public' : 'private')}
                type="checkbox"
              />
              <span className="text-sm">
                Show in post list
                <span className="block text-xs leading-5 text-[var(--color-muted)]">
                  Public published posts appear on the homepage.
                </span>
              </span>
            </label>

            <label className="space-y-2">
              <span className="block text-xs font-semibold uppercase text-[var(--color-muted)]">Slug / Alias</span>
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]"
                  value={form.slug}
                  onChange={(event) => updateField('slug', event.target.value)}
                  placeholder="auto-generated-from-title"
                />
                <button
                  className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-xs font-semibold"
                  onClick={generateSlug}
                  type="button"
                >
                  Auto
                </button>
              </div>
            </label>

            <label className="space-y-2">
              <span className="block text-xs font-semibold uppercase text-[var(--color-muted)]">Published at</span>
              <input
                className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-muted)]"
                readOnly
                value={form.publishedAt ? new Date(form.publishedAt).toLocaleString() : 'Set when published'}
              />
            </label>

            <details className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2">
              <summary className="cursor-pointer text-sm font-semibold">Advanced SEO</summary>
              <div className="mt-3 space-y-3">
                <label className="space-y-2">
                  <span className="block text-xs font-semibold uppercase text-[var(--color-muted)]">SEO Title</span>
                  <input
                    className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]"
                    value={form.seoTitle}
                    onChange={(event) => updateField('seoTitle', event.target.value)}
                  />
                </label>
                <label className="space-y-2">
                  <span className="block text-xs font-semibold uppercase text-[var(--color-muted)]">SEO Description</span>
                  <textarea
                    className="min-h-24 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]"
                    value={form.seoDescription}
                    onChange={(event) => updateField('seoDescription', event.target.value)}
                  />
                </label>
              </div>
            </details>
          </div>
        </div>

        {insertedImageTokens.length > 0 ? (
          <div className="rounded-lg border border-[var(--color-border)] bg-white/85 p-4 shadow-sm">
            <h2 className="text-sm font-semibold">Inserted images</h2>
            <div className="mt-3 space-y-2">
              {insertedImageTokens.map((token) => (
                <div className="rounded-lg border border-[var(--color-border)] bg-white p-3" key={token}>
                  <span className="block truncate text-xs text-[var(--color-muted)]">asset:{token}</span>
                  <button
                    className="mt-2 text-xs font-semibold text-red-700"
                    onClick={() => removeInsertedImage(token)}
                    type="button"
                  >
                    Remove from post
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </aside>
    </form>
  );
}
