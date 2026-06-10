import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { AssetRow } from '@/features/assets/asset.types';
import { renderMarkdown } from '@/features/posts/post.renderer';
import type { PostRow, PostStatus } from '@/features/posts/post.types';
import { enhanceCodeBlocks } from '@/lib/prose-controls';

const TEMPORARY_PAPER_KEY = 'sakura-cactus:temporary-paper';
const TEMPORARY_PAPER_TTL_MS = 24 * 60 * 60 * 1000;

interface ApiErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

interface PostEditorProps {
  post?: (PostRow & { tags?: Array<{ name: string }> }) | null;
  aboutMode?: boolean;
}

type PostFormState = {
  title: string;
  excerpt: string;
  tagInput: string;
  publishedAt: string;
  contentMarkdown: string;
  status: Exclude<PostStatus, 'deleted'>;
};

type SubmitAction = 'publish' | 'unpublish' | 'delete';
type SaveFeedback = 'idle' | 'success' | 'error';

type FormSnapshot = {
  title: string;
  excerpt: string;
  contentMarkdown: string;
  publishedAt: string;
  tags: string[];
};

type TemporaryPaper = {
  postId?: string;
  title: string;
  slug: string;
  excerpt: string;
  contentMarkdown: string;
  tags: string;
  coverImage: string;
  updatedAt: string;
  expiresAt: string;
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
    status: post?.status === 'deleted' ? 'draft' : (post?.status ?? 'draft')
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
    saved.publishedAt === current.publishedAt &&
    saved.tags.length === current.tags.length &&
    saved.tags.every((tag, index) => tag === current.tags[index])
  );
}

function isTemporaryPaper(value: unknown): value is TemporaryPaper {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const paper = value as Record<string, unknown>;
  return (
    (typeof paper.postId === 'string' || typeof paper.postId === 'undefined') &&
    typeof paper.title === 'string' &&
    typeof paper.slug === 'string' &&
    typeof paper.excerpt === 'string' &&
    typeof paper.contentMarkdown === 'string' &&
    typeof paper.tags === 'string' &&
    typeof paper.coverImage === 'string' &&
    typeof paper.updatedAt === 'string' &&
    typeof paper.expiresAt === 'string'
  );
}

function clearStoredTemporaryPaper() {
  try {
    window.localStorage.removeItem(TEMPORARY_PAPER_KEY);
  } catch {
    // localStorage may be unavailable in hardened browser contexts.
  }
}

function readStoredTemporaryPaper(): TemporaryPaper | null {
  try {
    const raw = window.localStorage.getItem(TEMPORARY_PAPER_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;

    if (!isTemporaryPaper(parsed)) {
      clearStoredTemporaryPaper();
      return null;
    }

    const expiresAt = new Date(parsed.expiresAt).getTime();

    if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
      clearStoredTemporaryPaper();
      return null;
    }

    return parsed;
  } catch {
    clearStoredTemporaryPaper();
    return null;
  }
}

function writeStoredTemporaryPaper(paper: TemporaryPaper): boolean {
  try {
    window.localStorage.setItem(TEMPORARY_PAPER_KEY, JSON.stringify(paper));
    return true;
  } catch {
    return false;
  }
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
  const pattern = /!\[[^\]]*]\(\s*(?:asset:|\/i\/)([A-Za-z0-9_-]{24,64})\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markdown)) !== null) {
    tokens.add(match[1]);
  }

  return [...tokens];
}

export function PostEditor({ post, aboutMode = false }: PostEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const splitPreviewRef = useRef<HTMLDivElement | null>(null);
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
  const [showPreviewTop, setShowPreviewTop] = useState(false);
  const [temporaryPaper, setTemporaryPaper] = useState<TemporaryPaper | null>(null);
  const isExisting = useMemo(() => Boolean(postId), [postId]);
  const currentSnapshot = useMemo(() => createSnapshot(form), [form]);
  const isDirty = useMemo(() => !snapshotsEqual(savedSnapshot, currentSnapshot), [savedSnapshot, currentSnapshot]);
  const previewHtml = useMemo(() => renderMarkdown(form.contentMarkdown), [form.contentMarkdown]);
  const isBusy = isSubmitting || isUploadingImage;
  const isCollected = form.status === 'published';
  const isCleanExistingPost = isExisting && isCollected && !isDirty && saveFeedback !== 'error';
  const mainActionLabel = isCollected ? '保存修订' : '收录';

  useEffect(() => {
    if (aboutMode) {
      return;
    }

    setTemporaryPaper(readStoredTemporaryPaper());
  }, [aboutMode]);

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

  useEffect(() => {
    window.requestAnimationFrame(() => {
      if (previewRef.current) {
        enhanceCodeBlocks(previewRef.current);
      }

      if (splitPreviewRef.current) {
        enhanceCodeBlocks(splitPreviewRef.current);
      }
    });
  }, [previewHtml, editorMode]);

  useEffect(() => {
    const preview = editorMode === 'split' ? splitPreviewRef.current : editorMode === 'preview' ? previewRef.current : null;

    if (!preview) {
      setShowPreviewTop(false);
      return;
    }

    const syncPreviewTop = () => {
      setShowPreviewTop(preview.scrollTop > 240);
    };

    preview.addEventListener('scroll', syncPreviewTop, { passive: true });
    syncPreviewTop();

    return () => {
      preview.removeEventListener('scroll', syncPreviewTop);
    };
  }, [editorMode, previewHtml]);

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

  function restoreTemporaryPaper() {
    const paper = readStoredTemporaryPaper();

    if (!paper) {
      setTemporaryPaper(null);
      setMessage(null);
      return;
    }

    setForm((current) => ({
      ...current,
      title: paper.title,
      excerpt: paper.excerpt,
      tagInput: paper.tags,
      contentMarkdown: paper.contentMarkdown
    }));
    setTemporaryPaper(paper);
    setMessage(null);
    setError(null);

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }

  function clearTemporaryPaper() {
    clearStoredTemporaryPaper();
    setTemporaryPaper(null);
    setMessage(null);
    setError(null);
  }

  function saveTemporaryPaper() {
    if (aboutMode) {
      return;
    }

    const now = new Date();
    const paper: TemporaryPaper = {
      postId: postId ?? undefined,
      title: form.title,
      slug: post?.slug ?? '',
      excerpt: form.excerpt,
      contentMarkdown: form.contentMarkdown,
      tags: form.tagInput,
      coverImage: '',
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TEMPORARY_PAPER_TTL_MS).toISOString()
    };

    setError(null);
    setSaveFeedback('idle');
    setSubmitAction(null);

    if (!writeStoredTemporaryPaper(paper)) {
      setMessage(null);
      setError('当前浏览器无法暂存临时纸页。');
      return;
    }

    setTemporaryPaper(paper);
    setMessage('已暂存为临时纸页，24 小时内可继续写。');
  }

  async function collectPost() {
    const wasCollected = isCollected;
    const publishedAt = postId ? toIsoDateTime(form.publishedAt) : null;
    setError(null);
    setMessage(null);
    setSaveFeedback('idle');
    setSubmitAction('publish');
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
          status: 'published',
          visibility: 'public',
          publishedAt,
          tags: form.tagInput
        })
      });

      if (!response.ok) {
        setError(await readError(response, 'Unable to save post.'));
        setSaveFeedback('error');
        return;
      }

      const payload = (await response.json()) as { ok: true; data: { post: PostRow & { tags?: Array<{ name: string }> } } };
      const savedPost = payload.data.post;
      const nextForm = postToState(payload.data.post);
      setPostId(savedPost.id);
      setForm(nextForm);
      setSavedSnapshot(createSnapshot(nextForm));
      markSavedAssetTokens(savedPost.content_markdown);
      clearStoredTemporaryPaper();
      setTemporaryPaper(null);
      setMessage(wasCollected ? '修订已保存。' : '已收录到博客。');
      setSaveFeedback('success');

      if (!postId && !aboutMode) {
        window.history.replaceState(null, '', `/write?post=${savedPost.id}`);
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
      window.location.assign(aboutMode ? '/about?fresh=1' : '/articles');
    } finally {
      setIsSubmitting(false);
      setSubmitAction(null);
    }
  }

  function primaryButtonText() {
    if (submitAction === 'publish' && isSubmitting) {
      return isCollected ? '保存中...' : '收录中...';
    }

    if (submitAction === 'publish' && saveFeedback === 'error') {
      return '保存失败，重试';
    }

    return mainActionLabel;
  }

  function scrollPreviewToTop() {
    const preview = editorMode === 'split' ? splitPreviewRef.current : editorMode === 'preview' ? previewRef.current : null;

    if (!preview) {
      return;
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    preview.scrollTo({
      top: 0,
      behavior: reduceMotion ? 'auto' : 'smooth'
    });
  }

  function renderPreview(ref: RefObject<HTMLDivElement | null>) {
    return (
      <div className="sc-writer-preview-wrap">
        <div ref={ref} className="sc-writer-preview sc-prose prose-content" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        <button
          className={`sc-preview-top-button ${showPreviewTop ? 'sc-preview-top-button-visible' : ''}`}
          onClick={scrollPreviewToTop}
          type="button"
          aria-label="返回预览顶部"
          aria-hidden={!showPreviewTop}
          tabIndex={showPreviewTop ? 0 : -1}
        >
          ↑ 顶部
        </button>
      </div>
    );
  }

  return (
    <form className="sc-writer" onSubmit={(event) => event.preventDefault()}>
      <div className="sc-writer-topbar">
        <div className="sc-writer-topbar-inner">
          <a className="sc-writer-back" href={aboutMode ? '/about' : '/articles'}>
            {aboutMode ? '← 返回关于' : '← 返回文章'}
          </a>
          <div className="sc-writer-top-actions" aria-hidden="true"></div>
        </div>
      </div>

      <header className="sc-writer-heading">
        <h1>{aboutMode ? '关于' : '写作'}</h1>
      </header>

      {!aboutMode && temporaryPaper ? (
        <div className="sc-temporary-paper" role="status">
          <span>有一页临时纸页 · 24 小时内可继续写</span>
          <div className="sc-temporary-paper-actions">
            <button type="button" onClick={restoreTemporaryPaper}>继续写</button>
            <button type="button" onClick={clearTemporaryPaper}>清空</button>
          </div>
        </div>
      ) : null}

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
              renderPreview(splitPreviewRef)
            ) : null}
            </div>
          ) : (
            renderPreview(previewRef)
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
          <h2 className="sc-writer-card-title">收录</h2>
          <div className="sc-writer-fields">
            <div className="sc-writer-publish-actions">
              {!aboutMode ? (
                <button
                  className="sc-button sc-button-secondary sc-writer-secondary-action disabled:opacity-60"
                  disabled={isBusy}
                  onClick={saveTemporaryPaper}
                  type="button"
                >
                  暂存
                </button>
              ) : null}
              <button
                className="sc-button sc-button-primary sc-writer-primary-action disabled:opacity-60"
                disabled={isBusy || isCleanExistingPost}
                onClick={collectPost}
                type="button"
              >
                {primaryButtonText()}
              </button>

            {isCollected ? (
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
            {message ? (
              <p className="sc-writer-message" role="status">
                <span>{message}</span>
              </p>
            ) : null}
            <p className="sc-writer-note">
              临时纸页只保存在当前浏览器；收录后会进入博客公开内容。
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
