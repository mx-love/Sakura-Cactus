import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { AssetRow } from '@/features/assets/asset.types';
import { extractAssetTokens, renderMarkdown } from '@/features/posts/post.renderer';
import type { PostRow, PostStatus } from '@/features/posts/post.types';
import { bindCodeCopyControls } from '@/lib/prose-controls';
import {
  TEMPORARY_PAPER_KEY,
  buildWriterAutosaveSnapshot,
  clearWriterAutosaveSnapshot,
  createWriterAutosaveComparable,
  formatWriterAutosaveTime,
  getWriterAutosaveKey,
  hasMeaningfulWriterContent,
  readWriterAutosaveSnapshot,
  writeWriterAutosaveSnapshot,
  type WriterAutosaveSnapshot
} from './postEditorAutosave';

const AUTOSAVE_DEBOUNCE_MS = 5_000;
const AUTOSAVE_CHECKPOINT_MS = 90_000;

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

type SubmitAction = 'publish' | 'delete';
type SaveFeedback = 'idle' | 'success' | 'error';

type FormSnapshot = {
  title: string;
  excerpt: string;
  contentMarkdown: string;
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

export function PostEditor({ post, aboutMode = false }: PostEditorProps) {
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const excerptInputRef = useRef<HTMLInputElement | null>(null);
  const tagInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const splitPreviewRef = useRef<HTMLDivElement | null>(null);
  const sessionUploadedTokensRef = useRef<Set<string>>(new Set());
  const latestFormRef = useRef<PostFormState>(postToState(post));
  const latestPostIdRef = useRef<string | null>(post?.id ?? null);
  const latestSlugRef = useRef(post?.slug ?? '');
  const isRestorePromptOpenRef = useRef(false);
  const autosaveDebounceTimerRef = useRef<number | null>(null);
  const autosaveCheckpointTimerRef = useRef<number | null>(null);
  const lastAutosaveComparableRef = useRef<string | null>(null);
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
  const [temporaryPaper, setTemporaryPaper] = useState<WriterAutosaveSnapshot | null>(null);
  const [pendingLocalRevision, setPendingLocalRevision] = useState<WriterAutosaveSnapshot | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [autosaveState, setAutosaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const [autosaveSavedAt, setAutosaveSavedAt] = useState<number | null>(null);
  const [autosaveRecoveryNotice, setAutosaveRecoveryNotice] = useState<string | null>(null);
  const isExisting = useMemo(() => Boolean(postId), [postId]);
  const isRecoveryPending = Boolean(temporaryPaper || pendingLocalRevision);
  const currentSnapshot = useMemo(() => createSnapshot(form), [form]);
  const isDirty = useMemo(() => !snapshotsEqual(savedSnapshot, currentSnapshot), [savedSnapshot, currentSnapshot]);
  const previewHtml = useMemo(() => renderMarkdown(form.contentMarkdown), [form.contentMarkdown]);
  const isBusy = isSubmitting || isUploadingImage;
  const isCollected = form.status === 'published';
  const isCleanExistingPost = isExisting && isCollected && !isDirty && saveFeedback !== 'error';
  const mainActionLabel = isCollected ? '保存修订' : '收录';
  const storageHintText = isExisting
    ? '本地修改只保存在当前浏览器；点击“保存修订”后才会同步到公开文章。'
    : '临时纸页只保存在当前浏览器；收录后会进入博客公开内容。';
  const autosaveStatusText = useMemo(() => {
    if (autosaveState === 'dirty') {
      return '有未暂存的更改';
    }

    if (autosaveState === 'saving') {
      return '正在自动暂存...';
    }

    if (autosaveState === 'saved' && autosaveSavedAt) {
      return `已自动暂存 ${formatWriterAutosaveTime(autosaveSavedAt)}`;
    }

    if (autosaveState === 'error') {
      return '自动暂存失败';
    }

    return null;
  }, [autosaveSavedAt, autosaveState]);

  useEffect(() => {
    setIsEditorReady(true);
  }, []);

  useEffect(() => {
    latestFormRef.current = form;
  }, [form]);

  useEffect(() => {
    latestPostIdRef.current = postId;
  }, [postId]);

  useEffect(() => {
    latestSlugRef.current = post?.slug ?? '';
  }, [post?.slug]);

  useEffect(() => {
    isRestorePromptOpenRef.current = Boolean(temporaryPaper || pendingLocalRevision);
  }, [pendingLocalRevision, temporaryPaper]);

  useEffect(() => {
    isRestorePromptOpenRef.current = false;
    setAutosaveRecoveryNotice(null);
    setTemporaryPaper(null);
    setPendingLocalRevision(null);
    setAutosaveState('idle');
    setAutosaveSavedAt(null);

    if (!isEditorReady) {
      return;
    }

    if (postId) {
      const storageKey = getWriterAutosaveKey(postId);
      const result = readWriterAutosaveSnapshot(storageKey);
      const serverUpdatedAt = post?.updated_at ? new Date(post.updated_at).getTime() : Number.NaN;
      const serverComparable = createWriterAutosaveComparable(
        buildWriterAutosaveSnapshot({
          postId,
          slug: post?.slug ?? '',
          title: post?.title ?? '',
          excerpt: post?.excerpt ?? '',
          contentMarkdown: post?.content_markdown ?? '',
          tagInput: post?.tags?.map((tag) => tag.name).join(', ') ?? '',
          coverImage: ''
        })
      );

      lastAutosaveComparableRef.current = serverComparable;

      if (result.error) {
        setAutosaveRecoveryNotice('发现一份无法恢复的本地暂存，已跳过恢复。');
        return;
      }

      if (!result.snapshot) {
        return;
      }

      const localComparable = createWriterAutosaveComparable(result.snapshot);
      if (localComparable === serverComparable) {
        clearWriterAutosaveSnapshot(storageKey);
        return;
      }

      const shouldPrompt = Number.isNaN(serverUpdatedAt) || result.snapshot.updatedAt > serverUpdatedAt;

      if (shouldPrompt) {
        isRestorePromptOpenRef.current = true;
        setPendingLocalRevision(result.snapshot);
        lastAutosaveComparableRef.current = localComparable;
        setAutosaveSavedAt(result.snapshot.updatedAt);
      }

      return;
    }

    if (aboutMode) {
      lastAutosaveComparableRef.current = null;
      return;
    }

    const result = readWriterAutosaveSnapshot(TEMPORARY_PAPER_KEY);

    if (result.error) {
      setAutosaveRecoveryNotice('发现一份无法恢复的本地暂存，已跳过恢复。');
      lastAutosaveComparableRef.current = null;
      return;
    }

    if (!result.snapshot) {
      lastAutosaveComparableRef.current = null;
      return;
    }

    setTemporaryPaper(result.snapshot);
    lastAutosaveComparableRef.current = createWriterAutosaveComparable(result.snapshot);
    setAutosaveSavedAt(result.snapshot.updatedAt);
  }, [aboutMode, isEditorReady, post, postId]);

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
    if (previewRef.current) {
      bindCodeCopyControls(previewRef.current);
    }

    if (splitPreviewRef.current) {
      bindCodeCopyControls(splitPreviewRef.current);
    }
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

  useEffect(() => {
    if (!isEditorReady || isRestorePromptOpenRef.current) {
      clearAutosaveTimers();
      return;
    }

    const snapshot = buildCurrentAutosaveSnapshot();

    if (!snapshot) {
      clearAutosaveTimers();
      setAutosaveState('idle');
      return;
    }

    const comparable = createWriterAutosaveComparable(snapshot);

    if (comparable === lastAutosaveComparableRef.current) {
      clearAutosaveTimers();
      return;
    }

    setAutosaveState((current) => (current === 'saving' ? current : 'dirty'));
    scheduleAutosave();
  }, [form.contentMarkdown, form.excerpt, form.tagInput, form.title, isEditorReady, pendingLocalRevision, postId, temporaryPaper]);

  useEffect(() => {
    if (!isEditorReady) {
      return;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        writeAutosaveSnapshot();
      }
    };
    const handlePageHide = () => {
      writeAutosaveSnapshot();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [isEditorReady]);

  useEffect(() => {
    return () => {
      clearAutosaveTimers();
    };
  }, []);

  function updateField<K extends keyof PostFormState>(field: K, value: PostFormState[K]) {
    setSaveFeedback('idle');
    setSubmitAction(null);
    setError(null);
    setForm((current) => ({ ...current, [field]: value }));
  }

  function clearAutosaveTimers() {
    if (autosaveDebounceTimerRef.current !== null) {
      window.clearTimeout(autosaveDebounceTimerRef.current);
      autosaveDebounceTimerRef.current = null;
    }

    if (autosaveCheckpointTimerRef.current !== null) {
      window.clearTimeout(autosaveCheckpointTimerRef.current);
      autosaveCheckpointTimerRef.current = null;
    }
  }

  function readLiveFormState(): PostFormState {
    const current = latestFormRef.current;

    return {
      ...current,
      title: titleInputRef.current?.value ?? current.title,
      excerpt: excerptInputRef.current?.value ?? current.excerpt,
      tagInput: tagInputRef.current?.value ?? current.tagInput,
      contentMarkdown: textareaRef.current?.value ?? current.contentMarkdown
    };
  }

  function syncFormFromInputs() {
    const next = readLiveFormState();
    const current = latestFormRef.current;

    if (
      next.title !== current.title ||
      next.excerpt !== current.excerpt ||
      next.tagInput !== current.tagInput ||
      next.contentMarkdown !== current.contentMarkdown
    ) {
      setSaveFeedback('idle');
      setSubmitAction(null);
      setError(null);
      latestFormRef.current = next;
      setForm((formState) =>
        formState.title === next.title &&
        formState.excerpt === next.excerpt &&
        formState.tagInput === next.tagInput &&
        formState.contentMarkdown === next.contentMarkdown
          ? formState
          : {
              ...formState,
              title: next.title,
              excerpt: next.excerpt,
              tagInput: next.tagInput,
              contentMarkdown: next.contentMarkdown
            }
      );
    }

    return next;
  }

  function buildCurrentAutosaveSnapshot(updatedAt = Date.now()): WriterAutosaveSnapshot | null {
    const liveForm = readLiveFormState();
    const snapshot = buildWriterAutosaveSnapshot({
      postId: latestPostIdRef.current,
      slug: latestSlugRef.current,
      title: liveForm.title,
      excerpt: liveForm.excerpt,
      contentMarkdown: liveForm.contentMarkdown,
      tagInput: liveForm.tagInput,
      coverImage: '',
      updatedAt
    });

    return hasMeaningfulWriterContent(snapshot) ? snapshot : null;
  }

  function createCurrentComparableFromLiveForm() {
    const liveForm = readLiveFormState();

    return createWriterAutosaveComparable({
      postId: latestPostIdRef.current,
      slug: latestSlugRef.current,
      title: liveForm.title,
      excerpt: liveForm.excerpt,
      contentMarkdown: liveForm.contentMarkdown,
      tagInput: liveForm.tagInput,
      coverImage: ''
    });
  }

  function updateAutosaveSavedState(snapshot: WriterAutosaveSnapshot) {
    lastAutosaveComparableRef.current = createWriterAutosaveComparable(snapshot);
    setAutosaveSavedAt(snapshot.updatedAt);
    setAutosaveRecoveryNotice(null);
    setAutosaveState('saved');
  }

  function writeAutosaveSnapshot(options: { force?: boolean } = {}) {
    if (!isEditorReady || isRestorePromptOpenRef.current) {
      return false;
    }

    const snapshot = buildCurrentAutosaveSnapshot();

    if (!snapshot) {
      clearAutosaveTimers();
      setAutosaveState('idle');
      return false;
    }

    const comparable = createWriterAutosaveComparable(snapshot);

    if (!options.force && comparable === lastAutosaveComparableRef.current) {
      clearAutosaveTimers();
      return false;
    }

    setAutosaveState('saving');
    const saved = writeWriterAutosaveSnapshot(snapshot.draftKey, snapshot);

    if (!saved) {
      clearAutosaveTimers();
      setAutosaveState('error');
      return false;
    }

    clearAutosaveTimers();
    updateAutosaveSavedState(snapshot);
    return true;
  }

  function scheduleAutosave() {
    clearAutosaveTimers();
    autosaveDebounceTimerRef.current = window.setTimeout(() => {
      writeAutosaveSnapshot();
    }, AUTOSAVE_DEBOUNCE_MS);
    autosaveCheckpointTimerRef.current = window.setTimeout(() => {
      writeAutosaveSnapshot();
    }, AUTOSAVE_CHECKPOINT_MS);
  }

  function focusContentEditor() {
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }

  // Read once from the live textarea before saving so we never submit a known-stale body.
  function syncContentFromTextarea() {
    return syncFormFromInputs().contentMarkdown;
  }

  function validatePublishedContent(contentMarkdown: string) {
    if (contentMarkdown.trim().length > 0) {
      return true;
    }

    setMessage(null);
    setSaveFeedback('error');
    setSubmitAction(null);
    setError('正文不能为空，请先填写内容。');
    focusContentEditor();
    return false;
  }

  async function readError(response: Response, fallback: string): Promise<string> {
    const payload = (await response.json().catch(() => null)) as ApiErrorResponse | null;
    return payload?.error.message ?? fallback;
  }

  function insertMarkdown(markdown: string) {
    const textarea = textareaRef.current;
    const currentContent = syncContentFromTextarea();
    const selectionStart = textarea?.selectionStart ?? currentContent.length;
    const selectionEnd = textarea?.selectionEnd ?? currentContent.length;
    const prefix = currentContent.slice(0, selectionStart);
    const suffix = currentContent.slice(selectionEnd);
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
    const text = event.clipboardData.getData('text/plain');
    const html = event.clipboardData.getData('text/html');
    const hasTextContent = text.trim().length > 0 || html.trim().length > 0;

    if (files.length > 0) {
      if (hasTextContent) {
        setError(null);
        setSaveFeedback('idle');
        setSubmitAction(null);
        setMessage('检测到文字和图片，已优先保留文字；图片未自动插入，请单独粘贴图片。');
        return;
      }

      event.preventDefault();
      await uploadAndInsertImages(files);
      return;
    }

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

  function applyAutosaveSnapshot(snapshot: WriterAutosaveSnapshot) {
    const nextForm = {
      ...latestFormRef.current,
      title: snapshot.title,
      excerpt: snapshot.excerpt,
      tagInput: snapshot.tagInput,
      contentMarkdown: snapshot.contentMarkdown
    };

    latestFormRef.current = nextForm;
    setForm(nextForm);
    updateAutosaveSavedState(snapshot);
    setAutosaveRecoveryNotice(null);
    setMessage(null);
    setError(null);
  }

  function restoreTemporaryPaper() {
    if (!temporaryPaper) {
      setMessage(null);
      return;
    }

    isRestorePromptOpenRef.current = false;
    applyAutosaveSnapshot(temporaryPaper);
    setTemporaryPaper(null);

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }

  function clearTemporaryPaper() {
    isRestorePromptOpenRef.current = false;
    clearWriterAutosaveSnapshot(TEMPORARY_PAPER_KEY);
    clearAutosaveTimers();
    lastAutosaveComparableRef.current = createCurrentComparableFromLiveForm();
    setTemporaryPaper(null);
    setAutosaveState('idle');
    setAutosaveSavedAt(null);
    setAutosaveRecoveryNotice(null);
    setMessage(null);
    setError(null);
  }

  function restoreLocalRevision() {
    if (!pendingLocalRevision) {
      return;
    }

    isRestorePromptOpenRef.current = false;
    applyAutosaveSnapshot(pendingLocalRevision);
    setPendingLocalRevision(null);

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }

  function ignoreLocalRevision() {
    if (!pendingLocalRevision) {
      return;
    }

    isRestorePromptOpenRef.current = false;
    clearWriterAutosaveSnapshot(getWriterAutosaveKey(pendingLocalRevision.postId));
    clearAutosaveTimers();
    lastAutosaveComparableRef.current = createCurrentComparableFromLiveForm();
    setPendingLocalRevision(null);
    setAutosaveState('idle');
    setAutosaveSavedAt(null);
    setAutosaveRecoveryNotice(null);
  }

  function saveTemporaryPaper() {
    if (aboutMode || isExisting || isRecoveryPending) {
      return;
    }

    if (!isEditorReady) {
      setMessage(null);
      setError('编辑器准备中，请稍候。');
      return;
    }

    const liveForm = syncFormFromInputs();
    const snapshot = buildWriterAutosaveSnapshot({
      postId: null,
      slug: latestSlugRef.current,
      title: liveForm.title,
      excerpt: liveForm.excerpt,
      contentMarkdown: liveForm.contentMarkdown,
      tagInput: liveForm.tagInput,
      coverImage: ''
    });

    setError(null);
    setSaveFeedback('idle');
    setSubmitAction(null);

    if (!hasMeaningfulWriterContent(snapshot)) {
      setMessage(null);
      setError('当前没有可暂存的内容。');
      return;
    }

    if (!writeWriterAutosaveSnapshot(TEMPORARY_PAPER_KEY, snapshot)) {
      setMessage(null);
      setError('当前浏览器无法暂存临时纸页。');
      setAutosaveState('error');
      return;
    }

    clearAutosaveTimers();
    updateAutosaveSavedState(snapshot);
    setMessage('已暂存为临时纸页，24 小时内可继续写。');
  }

  async function collectPost() {
    if (!isEditorReady) {
      setMessage(null);
      setError('编辑器准备中，请稍候。');
      return;
    }

    const liveForm = syncFormFromInputs();
    const contentMarkdown = liveForm.contentMarkdown;

    if (!validatePublishedContent(contentMarkdown)) {
      return;
    }

    const wasCollected = isCollected;
    const publishedAt = postId ? toIsoDateTime(liveForm.publishedAt) : null;
    const autosaveKey = getWriterAutosaveKey(postId);
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
          title: liveForm.title,
          excerpt: liveForm.excerpt,
          contentMarkdown,
          status: 'published',
          visibility: 'public',
          publishedAt,
          tags: liveForm.tagInput
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
      clearWriterAutosaveSnapshot(autosaveKey);
      clearAutosaveTimers();
      lastAutosaveComparableRef.current = createWriterAutosaveComparable(
        buildWriterAutosaveSnapshot({
          postId: savedPost.id,
          slug: savedPost.slug,
          title: nextForm.title,
          excerpt: nextForm.excerpt,
          contentMarkdown: nextForm.contentMarkdown,
          tagInput: nextForm.tagInput,
          coverImage: '',
          updatedAt: Date.now()
        })
      );
      setPostId(savedPost.id);
      setForm(nextForm);
      setSavedSnapshot(createSnapshot(nextForm));
      markSavedAssetTokens(savedPost.content_markdown);
      setTemporaryPaper(null);
      setPendingLocalRevision(null);
      setAutosaveState('idle');
      setAutosaveSavedAt(null);
      setMessage(wasCollected ? '修订已保存。' : '已收录到博客。');
      setSaveFeedback('success');

      if (!aboutMode && !wasCollected) {
        window.location.assign(`/posts/${encodeURIComponent(savedPost.slug)}`);
      }
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
      clearWriterAutosaveSnapshot(getWriterAutosaveKey(postId));
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
          <span>发现一张尚未完成的临时纸页</span>
          <div className="sc-temporary-paper-actions">
            <button type="button" onClick={restoreTemporaryPaper}>继续写</button>
            <button type="button" onClick={clearTemporaryPaper}>舍弃暂存</button>
          </div>
        </div>
      ) : null}

      {pendingLocalRevision ? (
        <div className="sc-temporary-paper" role="status">
          <span>发现未提交的本地修改</span>
          <div className="sc-temporary-paper-actions">
            <button type="button" onClick={restoreLocalRevision}>恢复本地修改</button>
            <button type="button" onClick={ignoreLocalRevision}>舍弃本地修改</button>
          </div>
        </div>
      ) : null}

      {autosaveRecoveryNotice ? (
        <p className="sc-writer-message" role="status">
          <span>{autosaveRecoveryNotice}</span>
        </p>
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
              {!isEditorReady ? <span className="sc-badge">编辑器准备中</span> : null}
              {isEditorReady && isUploadingImage ? <span className="sc-badge">上传中</span> : null}
            </div>
          </div>

          {editorMode === 'edit' || editorMode === 'split' ? (
            <div className={editorMode === 'split' ? 'sc-writer-split' : 'sc-writer-editor-wrap'}>
              <textarea
                ref={textareaRef}
                className="sc-writer-textarea"
                placeholder="Write Markdown here. Paste or drop images to upload."
                value={form.contentMarkdown}
                disabled={!isEditorReady || isRecoveryPending}
                onInput={(event) => updateField('contentMarkdown', event.currentTarget.value)}
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
                ref={titleInputRef}
                aria-label="Post title"
                className="sc-input sc-writer-control"
                placeholder="标题"
                value={form.title}
                disabled={isRecoveryPending}
                onChange={(event) => updateField('title', event.target.value)}
                required
              />
            </label>

            <label className="sc-writer-field sc-writer-field-plain">
              <input
                ref={excerptInputRef}
                aria-label="Post excerpt"
                className="sc-input sc-writer-control"
                placeholder="简介"
                value={form.excerpt}
                disabled={isRecoveryPending}
                onChange={(event) => updateField('excerpt', event.target.value)}
              />
            </label>

            <label className="sc-writer-field sc-writer-field-plain">
              <input
                ref={tagInputRef}
                className="sc-input sc-writer-control"
                placeholder="标签"
                value={form.tagInput}
                disabled={isRecoveryPending}
                onChange={(event) => updateField('tagInput', event.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="sc-writer-card">
          <h2 className="sc-writer-card-title">收录</h2>
          <div className="sc-writer-fields">
            <div className="sc-writer-publish-actions">
              {!aboutMode && !isExisting ? (
                <button
                  className="sc-button sc-button-secondary sc-writer-secondary-action disabled:opacity-60"
                  disabled={isBusy || !isEditorReady || isRecoveryPending}
                  onClick={saveTemporaryPaper}
                  type="button"
                >
                  暂存
                </button>
              ) : null}
              <button
                className="sc-button sc-button-primary sc-writer-primary-action disabled:opacity-60"
                disabled={!isEditorReady || isBusy || isCleanExistingPost || isRecoveryPending}
                onClick={collectPost}
                type="button"
              >
                {primaryButtonText()}
              </button>
            </div>

            {error ? <p className="sc-field-error sc-writer-error">{error}</p> : null}
            {message ? (
              <p className="sc-writer-message" role="status">
                <span>{message}</span>
              </p>
            ) : null}
            {!isRecoveryPending && autosaveStatusText ? <p className="sc-writer-note">{autosaveStatusText}</p> : null}
            <p className="sc-writer-note">
              {storageHintText}
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
