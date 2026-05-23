import { useEffect, useMemo, useRef, useState } from 'react';
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
  post?: (PostRow & { tags?: Array<{ name: string }> }) | null;
}

type PostFormState = {
  title: string;
  excerpt: string;
  tagInput: string;
  publishedAt: string;
  contentMarkdown: string;
  status: Exclude<PostStatus, 'deleted'>;
  visibility: PostVisibility;
};

type SubmitAction = 'draft' | 'publish' | 'unpublish' | 'delete';
type SaveFeedback = 'idle' | 'success' | 'error';

type FormSnapshot = {
  title: string;
  excerpt: string;
  contentMarkdown: string;
  visibility: PostVisibility;
  publishedAt: string;
  tags: string[];
};

function toDateTimeLocal(value: string | null | undefined): string {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toIsoDateTime(value: string): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function postToState(post?: (PostRow & { tags?: Array<{ name: string }> }) | null): PostFormState {
  return {
    title: post?.title ?? '',
    excerpt: post?.excerpt ?? '',
    tagInput: post?.tags?.map((tag) => tag.name).join(', ') ?? '',
    publishedAt: toDateTimeLocal(post?.published_at),
    contentMarkdown: post?.content_markdown ?? '',
    status: post?.status === 'deleted' ? 'draft' : (post?.status ?? 'draft'),
    visibility: post?.visibility ?? 'public'
  };
}

function normalizeTagInput(value: string): string[] {
  return value
    .split(/[,，#\s]+/)
    .map((tag) => tag.trim().replace(/^#+/, ''))
    .filter(Boolean)
    .map((tag) => tag.toLocaleLowerCase())
    .sort();
}

function createSnapshot(form: PostFormState): FormSnapshot {
  return {
    title: form.title.trim(),
    excerpt: form.excerpt.trim(),
    contentMarkdown: form.contentMarkdown,
    visibility: form.visibility,
    publishedAt: form.publishedAt,
    tags: normalizeTagInput(form.tagInput)
  };
}

function snapshotsEqual(saved: FormSnapshot | null, current: FormSnapshot): boolean {
  if (!saved) {
    return false;
  }

  return (
    saved.title === current.title &&
    saved.excerpt === current.excerpt &&
    saved.contentMarkdown === current.contentMarkdown &&
    saved.visibility === current.visibility &&
    saved.publishedAt === current.publishedAt &&
    saved.tags.length === current.tags.length &&
    saved.tags.every((tag, index) => tag === current.tags[index])
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

function extractAssetTokens(markdown: string): string[] {
  const tokens = new Set<string>();
  const pattern = /!\[[^\]]*]\(\s*asset:([A-Za-z0-9_-]{24,64})\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markdown)) !== null) {
    tokens.add(match[1]);
  }

  return [...tokens];
}

export function PostEditor({ post }: PostEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionUploadedTokensRef = useRef<Set<string>>(new Set());
  const [form, setForm] = useState<PostFormState>(() => postToState(post));
  const [savedSnapshot, setSavedSnapshot] = useState<FormSnapshot | null>(() => (post ? createSnapshot(postToState(post)) : null));
  const [postId, setPostId] = useState(post?.id ?? null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitAction, setSubmitAction] = useState<SubmitAction | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback>('idle');
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [editorMode, setEditorMode] = useState<'edit' | 'preview' | 'split'>('edit');
  const isExisting = useMemo(() => Boolean(postId), [postId]);
  const currentSnapshot = useMemo(() => createSnapshot(form), [form]);
  const isDirty = useMemo(() => !snapshotsEqual(savedSnapshot, currentSnapshot), [savedSnapshot, currentSnapshot]);
  const previewHtml = useMemo(() => renderMarkdown(form.contentMarkdown), [form.contentMarkdown]);
  const isPublished = form.status === 'published';
  const isBusy = isSubmitting || isUploadingImage;
  const statusClass = form.status === 'published' ? 'sc-badge-published' : form.status === 'archived' ? 'sc-badge-archived' : 'sc-badge-draft';
  const isCleanExistingPost = isExisting && !isDirty && saveFeedback !== 'error';
  const mainActionLabel = isCleanExistingPost ? '已保存' : isPublished ? '更新' : '发布';

  useEffect(() => {
    const handlePageExit = () => {
      cleanupUnsavedSessionUploads();
    };

    window.addEventListener('pagehide', handlePageExit);
    window.addEventListener('beforeunload', handlePageExit);

    return () => {
      window.removeEventListener('pagehide', handlePageExit);
      window.removeEventListener('beforeunload', handlePageExit);
    };
  }, []);

  function updateField<K extends keyof PostFormState>(field: K, value: PostFormState[K]) {
    setSaveFeedback('idle');
    setSubmitAction(null);
    setError(null);
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

    const payload = (await response.json()) as {
      ok: true;
      data: { asset: AssetRow; url: string; created: boolean; reused: boolean };
    };
    return payload.data;
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
        const upload = await uploadImageFile(image);
        const { asset } = upload;

        if (upload.created) {
          sessionUploadedTokensRef.current.add(asset.token);
        }

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

  function markSavedAssetTokens(markdown: string) {
    for (const token of extractAssetTokens(markdown)) {
      sessionUploadedTokensRef.current.delete(token);
    }
  }

  function cleanupUnsavedSessionUploads() {
    const tokens = [...sessionUploadedTokensRef.current];

    if (tokens.length === 0) {
      return;
    }

    sessionUploadedTokensRef.current.clear();

    const payload = JSON.stringify({ tokens });
    const endpoint = '/api/admin/assets/cleanup-unsaved';

    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });

      if (navigator.sendBeacon(endpoint, blob)) {
        return;
      }
    }

    void fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'same-origin',
      body: payload,
      keepalive: true
    }).catch(() => undefined);
  }

  async function saveWithStatus(status: Exclude<PostStatus, 'deleted'>) {
    const action: SubmitAction = status === 'published' ? 'publish' : 'draft';
    setError(null);
    setMessage(null);
    setSaveFeedback('idle');
    setSubmitAction(action);
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
          excerpt: form.excerpt,
          contentMarkdown: form.contentMarkdown,
          status,
          visibility: form.visibility,
          publishedAt: toIsoDateTime(form.publishedAt),
          tags: form.tagInput
        })
      });

      if (!response.ok) {
        setError(await readError(response, 'Unable to save post.'));
        setSaveFeedback('error');
        return;
      }

      const payload = (await response.json()) as { ok: true; data: { post: PostRow & { tags?: Array<{ name: string }> } } };
      const nextForm = postToState(payload.data.post);
      setPostId(payload.data.post.id);
      setForm(nextForm);
      setSavedSnapshot(createSnapshot(nextForm));
      markSavedAssetTokens(payload.data.post.content_markdown);
      setMessage(status === 'published' ? '已发布' : '已保存');
      setSaveFeedback('success');

      if (!postId) {
        window.history.replaceState(null, '', `/write?post=${payload.data.post.id}`);
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
    setSaveFeedback('idle');
    setSubmitAction('unpublish');
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/posts/${postId}/unpublish`, {
        method: 'POST',
        credentials: 'same-origin'
      });

      if (!response.ok) {
        setError(await readError(response, 'Unable to unpublish post.'));
        setSaveFeedback('error');
        return;
      }

      const payload = (await response.json()) as { ok: true; data: { post: PostRow & { tags?: Array<{ name: string }> } } };
      const nextForm = postToState(payload.data.post);
      setForm(nextForm);
      setSavedSnapshot(createSnapshot(nextForm));
      setMessage('已下架');
      setSaveFeedback('success');
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
    setSubmitAction('delete');
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

      cleanupUnsavedSessionUploads();
      window.location.assign('/articles');
    } finally {
      setIsSubmitting(false);
      setSubmitAction(null);
    }
  }

  function saveButtonText(action: SubmitAction, idleLabel: string) {
    if (submitAction === action && isSubmitting) {
      return action === 'publish' && isPublished ? '更新中...' : '保存中...';
    }

    if (submitAction === action && saveFeedback === 'success') {
      return '已保存';
    }

    if (submitAction === action && saveFeedback === 'error') {
      return '保存失败，重试';
    }

    return idleLabel;
  }

  return (
    <form className="sc-writer" onSubmit={(event) => event.preventDefault()}>
      <div className="sc-writer-topbar">
        <div className="sc-writer-topbar-inner">
          <a className="sc-writer-back" href="/articles">
            ← 返回文章
          </a>
          <div className="sc-writer-top-actions" aria-hidden="true"></div>
        </div>
      </div>

      <div className="sc-writer-grid">
      <div className="sc-writer-main">
        <div className="sc-writer-canvas">
          <div className="sc-writer-tabs">
            <div className="sc-writer-tab-list">
              <button
                className={`sc-writer-tab ${editorMode === 'edit' ? 'sc-writer-tab-active' : ''}`}
                onClick={() => setEditorMode('edit')}
                type="button"
              >
                编辑
              </button>
              <button
                className={`sc-writer-tab ${editorMode === 'preview' ? 'sc-writer-tab-active' : ''}`}
                onClick={() => setEditorMode('preview')}
                type="button"
              >
                预览
              </button>
              <button
                className={`sc-writer-tab ${editorMode === 'split' ? 'sc-writer-tab-active' : ''}`}
                onClick={() => setEditorMode('split')}
                type="button"
              >
                分屏
              </button>
            </div>
            <div className="sc-writer-upload-state">
              {isUploadingImage ? <span className="sc-badge">上传中</span> : null}
            </div>
          </div>

          {editorMode === 'edit' || editorMode === 'split' ? (
            <div className={editorMode === 'split' ? 'sc-writer-split' : 'sc-writer-editor-wrap'}>
            <textarea
              ref={textareaRef}
              className="sc-writer-textarea"
              placeholder="Write Markdown here. Paste or drop images to upload."
              value={form.contentMarkdown}
              onChange={(event) => updateField('contentMarkdown', event.target.value)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
              onPaste={handlePaste}
              required
            />
            {editorMode === 'split' ? (
              <div className="sc-writer-preview sc-prose prose-content" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            ) : null}
            </div>
          ) : (
            <div className="sc-writer-preview sc-prose prose-content" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          )}
        </div>

      </div>

      <aside className="sc-writer-side">
        <div className="sc-writer-card">
          <h2 className="sc-writer-card-title">文章设置</h2>
          <div className="sc-writer-fields">
            <label className="sc-writer-field sc-writer-field-plain">
              <input
                aria-label="Post title"
                className="sc-input sc-writer-control"
                placeholder="标题"
                value={form.title}
                onChange={(event) => updateField('title', event.target.value)}
                required
              />
            </label>

            <label className="sc-writer-field sc-writer-field-plain">
              <input
                aria-label="Post excerpt"
                className="sc-input sc-writer-control"
                placeholder="简介"
                value={form.excerpt}
                onChange={(event) => updateField('excerpt', event.target.value)}
              />
            </label>

            <label className="sc-writer-field sc-writer-field-plain">
              <input
                className="sc-input sc-writer-control"
                placeholder="标签"
                value={form.tagInput}
                onChange={(event) => updateField('tagInput', event.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="sc-writer-card">
          <h2 className="sc-writer-card-title">发布设置</h2>
          <div className="sc-writer-fields">
            <div className="sc-writer-status-row">
              <span>状态</span>
              <span className={`sc-badge ${statusClass}`}>{statusLabel(form.status)}</span>
            </div>

            <div className="sc-writer-field">
              <span>可见性</span>
              <div className="sc-writer-visibility">
                <button
                  className={form.visibility === 'public' ? 'sc-writer-choice sc-writer-choice-active' : 'sc-writer-choice'}
                  onClick={() => updateField('visibility', 'public')}
                  type="button"
                >
                  公开
                </button>
                <button
                  className={form.visibility === 'private' ? 'sc-writer-choice sc-writer-choice-active' : 'sc-writer-choice'}
                  onClick={() => updateField('visibility', 'private')}
                  type="button"
                >
                  仅自己
                </button>
              </div>
            </div>

            <label className="sc-writer-field">
              <span>发布时间</span>
              <input
                className="sc-input sc-writer-control"
                type="datetime-local"
                value={form.publishedAt}
                onChange={(event) => updateField('publishedAt', event.target.value)}
              />
            </label>

            <div className="sc-writer-publish-actions">
              {!isPublished ? (
                <button
                  className="sc-button sc-button-secondary sc-writer-secondary-action disabled:opacity-60"
                  disabled={isBusy || isCleanExistingPost}
                  onClick={() => saveWithStatus('draft')}
                  type="button"
                >
                  {saveButtonText('draft', '保存草稿')}
                </button>
              ) : null}
              <button
                className="sc-button sc-button-primary sc-writer-primary-action disabled:opacity-60"
                disabled={isBusy || isCleanExistingPost}
                onClick={() => saveWithStatus('published')}
                type="button"
              >
                {saveButtonText('publish', mainActionLabel)}
              </button>

            {isPublished ? (
              <button
                className="sc-button sc-button-secondary sc-writer-secondary-action disabled:opacity-60"
                disabled={isSubmitting || !isExisting}
                onClick={unpublish}
                type="button"
              >
                {submitAction === 'unpublish' && isSubmitting ? '下架中...' : '下架'}
              </button>
            ) : null}
            </div>

            {error ? <p className="sc-field-error sc-writer-error">{error}</p> : null}
            <p className="sc-writer-note">
              公开发布后会显示在文章列表。
            </p>
          </div>
        </div>

        {isExisting ? (
          <div className="sc-writer-danger">
            <h2>纸页整理</h2>
            <button
              className="sc-button sc-button-danger sc-writer-secondary-action disabled:opacity-60"
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
