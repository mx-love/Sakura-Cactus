export const ARTICLE_IMAGE_VIEWER_MIN_ZOOM = 1;
export const ARTICLE_IMAGE_VIEWER_MAX_ZOOM = 4;
export type ArticleImageViewerTransform = { zoom: number; panX: number; panY: number };
export type ArticleImageViewerBounds = { imageWidth: number; imageHeight: number; stageWidth: number; stageHeight: number };
type ViewerElements = {
  dialog: HTMLDialogElement; shell: HTMLElement; stage: HTMLElement; image: HTMLImageElement;
  close: HTMLButtonElement; zoomOut: HTMLButtonElement; fit: HTMLButtonElement;
  zoomIn: HTMLButtonElement; original: HTMLAnchorElement;
};
type ScrollLock = { x: number; y: number; bodyStyle: string | null };
let activeTeardown: (() => void) | null = null;

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function resetArticleImageViewerTransform(): ArticleImageViewerTransform {
  return { zoom: ARTICLE_IMAGE_VIEWER_MIN_ZOOM, panX: 0, panY: 0 };
}

export function constrainArticleImageViewerTransform(
  transform: ArticleImageViewerTransform,
  bounds: ArticleImageViewerBounds
): ArticleImageViewerTransform {
  const zoom = clamp(
    finiteOrZero(transform.zoom) || ARTICLE_IMAGE_VIEWER_MIN_ZOOM,
    ARTICLE_IMAGE_VIEWER_MIN_ZOOM,
    ARTICLE_IMAGE_VIEWER_MAX_ZOOM
  );

  if (zoom === ARTICLE_IMAGE_VIEWER_MIN_ZOOM) {
    return resetArticleImageViewerTransform();
  }

  const imageWidth = Math.max(0, finiteOrZero(bounds.imageWidth));
  const imageHeight = Math.max(0, finiteOrZero(bounds.imageHeight));
  const stageWidth = Math.max(0, finiteOrZero(bounds.stageWidth));
  const stageHeight = Math.max(0, finiteOrZero(bounds.stageHeight));
  const maximumX = Math.max(0, (imageWidth * zoom - stageWidth) / 2);
  const maximumY = Math.max(0, (imageHeight * zoom - stageHeight) / 2);

  return {
    zoom,
    panX: clamp(finiteOrZero(transform.panX), -maximumX, maximumX),
    panY: clamp(finiteOrZero(transform.panY), -maximumY, maximumY)
  };
}

function getElements(root: ParentNode): ViewerElements | null {
  const dialog = root.querySelector('[data-article-image-viewer]');
  if (!(dialog instanceof HTMLDialogElement) || typeof dialog.showModal !== 'function') {
    return null;
  }
  const shell = dialog.querySelector<HTMLElement>('[data-viewer-shell]');
  const stage = dialog.querySelector<HTMLElement>('[data-viewer-stage]');
  const image = dialog.querySelector<HTMLImageElement>('[data-viewer-image]');
  const close = dialog.querySelector<HTMLButtonElement>('[data-viewer-close]');
  const zoomOut = dialog.querySelector<HTMLButtonElement>('[data-viewer-zoom-out]');
  const fit = dialog.querySelector<HTMLButtonElement>('[data-viewer-fit]');
  const zoomIn = dialog.querySelector<HTMLButtonElement>('[data-viewer-zoom-in]');
  const original = dialog.querySelector<HTMLAnchorElement>('[data-viewer-original]');
  if (!shell || !stage || !image || !close || !zoomOut || !fit || !zoomIn || !original) return null;
  return { dialog, shell, stage, image, close, zoomOut, fit, zoomIn, original };
}

function sourceForImage(image: HTMLImageElement): string | null {
  const source = image.currentSrc || image.getAttribute('src')?.trim() || '';

  try {
    const url = new URL(source, window.location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function bindArticleImageViewer(root: ParentNode = document): () => void {
  activeTeardown?.();
  activeTeardown = null;

  const article = root.querySelector('[data-article-image-viewer-root]');
  const elements = getElements(root);

  if (!(article instanceof HTMLElement) || !elements) {
    return () => undefined;
  }

  const { dialog, shell, stage, image, close, zoomOut, fit, zoomIn, original } = elements;
  const controller = new AbortController();
  const { signal } = controller;
  const enhancedImages = Array.from(article.querySelectorAll('img[src]')).filter(
    (candidate): candidate is HTMLImageElement =>
      candidate instanceof HTMLImageElement && sourceForImage(candidate) !== null
  );
  let transform = resetArticleImageViewerTransform();
  let activeImage: HTMLImageElement | null = null;
  let activePointerId: number | null = null;
  let pointerX = 0;
  let pointerY = 0;
  let scrollLock: ScrollLock | null = null;
  let openRequest = 0;
  let openFrame = 0;
  let resizeFrame = 0;
  let disposed = false;

  function bounds(): ArticleImageViewerBounds {
    return {
      imageWidth: image.offsetWidth,
      imageHeight: image.offsetHeight,
      stageWidth: stage.clientWidth,
      stageHeight: stage.clientHeight
    };
  }

  function applyTransform(): void {
    transform = constrainArticleImageViewerTransform(transform, bounds());
    image.style.transform =
      `translate3d(${transform.panX}px, ${transform.panY}px, 0) scale(${transform.zoom})`;
    const zoomed = transform.zoom > ARTICLE_IMAGE_VIEWER_MIN_ZOOM;
    stage.classList.toggle('sc-image-viewer-stage-zoomed', zoomed);
    zoomOut.disabled = !zoomed;
    fit.disabled = !zoomed && transform.panX === 0 && transform.panY === 0;
    zoomIn.disabled = transform.zoom >= ARTICLE_IMAGE_VIEWER_MAX_ZOOM;
  }

  function resetTransform(): void {
    transform = resetArticleImageViewerTransform();
    applyTransform();
  }

  function setZoom(zoom: number): void {
    transform = { ...transform, zoom };
    applyTransform();
  }

  function cancelFrames(): void {
    if (openFrame) window.cancelAnimationFrame(openFrame);
    if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
    openFrame = 0;
    resizeFrame = 0;
  }

  function lockScroll(): void {
    if (scrollLock) return;
    const body = document.body;
    scrollLock = { x: window.scrollX, y: window.scrollY, bodyStyle: body.getAttribute('style') };
    body.style.position = 'fixed';
    body.style.inset = `${-scrollLock.y}px 0 0 ${-scrollLock.x}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';
  }

  function unlockScroll(): void {
    if (!scrollLock) return;
    const saved = scrollLock;
    scrollLock = null;
    if (saved.bodyStyle === null) document.body.removeAttribute('style');
    else document.body.setAttribute('style', saved.bodyStyle);
    window.scrollTo(saved.x, saved.y);
  }

  function endDrag(event?: PointerEvent): void {
    if (event && activePointerId !== event.pointerId) return;
    if (activePointerId !== null && image.hasPointerCapture(activePointerId)) {
      image.releasePointerCapture(activePointerId);
    }
    activePointerId = null;
    stage.classList.remove('sc-image-viewer-stage-dragging');
  }

  function clearViewer(restoreFocus: boolean): void {
    cancelFrames();
    openRequest += 1;
    endDrag();
    resetTransform();
    unlockScroll();
    const trigger = activeImage;
    activeImage = null;
    image.removeAttribute('src');
    image.alt = '';
    original.removeAttribute('href');
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  async function fitLoadedImage(request: number): Promise<void> {
    try {
      await image.decode();
    } catch {
      // A failed source still leaves the native dialog controls usable.
    }

    if (request !== openRequest || !dialog.open || disposed) return;
    if (openFrame) window.cancelAnimationFrame(openFrame);
    openFrame = window.requestAnimationFrame(() => {
      openFrame = 0;
      if (request !== openRequest || !dialog.open || disposed) return;
      resetTransform();
    });
  }

  function openViewer(trigger: HTMLImageElement): void {
    if (dialog.open) return;
    const source = sourceForImage(trigger);
    if (!source) return;

    openRequest += 1;
    const request = openRequest;
    activeImage = trigger;
    resetTransform();
    image.src = source;
    image.alt = trigger.alt;
    original.href = source;

    try {
      dialog.showModal();
    } catch {
      clearViewer(false);
      return;
    }

    close.focus({ preventScroll: true });
    lockScroll();
    void fitLoadedImage(request);
  }

  function closeViewer(): void {
    cancelFrames();
    openRequest += 1;
    if (dialog.open) dialog.close();
  }

  enhancedImages.forEach((trigger) => {
    trigger.tabIndex = 0;
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-label', '查看大图');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', dialog.id);
  });

  article.addEventListener('click', (event) => {
    const trigger = event.target;
    if (
      !(trigger instanceof HTMLImageElement) ||
      !enhancedImages.includes(trigger) ||
      event.button !== 0 ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    ) return;
    event.preventDefault();
    event.stopPropagation();
    openViewer(trigger);
  }, { signal });

  article.addEventListener('keydown', (event) => {
    const trigger = event.target;
    if (
      !(trigger instanceof HTMLImageElement) ||
      !enhancedImages.includes(trigger) ||
      (event.key !== 'Enter' && event.key !== ' ')
    ) return;
    event.preventDefault();
    event.stopPropagation();
    openViewer(trigger);
  }, { signal });

  close.addEventListener('click', closeViewer, { signal });
  zoomOut.addEventListener('click', () => setZoom(transform.zoom - 0.5), { signal });
  fit.addEventListener('click', resetTransform, { signal });
  zoomIn.addEventListener('click', () => setZoom(transform.zoom + 0.5), { signal });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeViewer();
  }, { signal });
  dialog.addEventListener('close', () => clearViewer(true), { signal });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target === shell || event.target === stage) closeViewer();
  }, { signal });
  image.addEventListener('dragstart', (event) => event.preventDefault(), { signal });

  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    setZoom(transform.zoom * Math.exp(-event.deltaY * 0.0015));
  }, { passive: false, signal });

  stage.addEventListener('pointerdown', (event) => {
    if (
      transform.zoom <= ARTICLE_IMAGE_VIEWER_MIN_ZOOM ||
      event.target !== image ||
      activePointerId !== null ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) return;
    activePointerId = event.pointerId;
    pointerX = event.clientX;
    pointerY = event.clientY;
    image.setPointerCapture(event.pointerId);
    stage.classList.add('sc-image-viewer-stage-dragging');
    event.preventDefault();
  }, { signal });

  stage.addEventListener('pointermove', (event) => {
    if (event.pointerId !== activePointerId) return;
    transform = {
      ...transform,
      panX: transform.panX + event.clientX - pointerX,
      panY: transform.panY + event.clientY - pointerY
    };
    pointerX = event.clientX;
    pointerY = event.clientY;
    applyTransform();
    event.preventDefault();
  }, { signal });
  stage.addEventListener('pointerup', (event) => endDrag(event), { signal });
  stage.addEventListener('pointercancel', (event) => endDrag(event), { signal });

  function scheduleResize(): void {
    if (!dialog.open || resizeFrame) return;
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      if (dialog.open) applyTransform();
    });
  }

  window.addEventListener('resize', scheduleResize, { signal });
  window.visualViewport?.addEventListener('resize', scheduleResize, { signal });
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) teardown();
  }, { signal });

  function teardown(): void {
    if (disposed) return;
    disposed = true;
    if (dialog.open) dialog.close();
    clearViewer(false);
    controller.abort();
    enhancedImages.forEach((trigger) => {
      trigger.removeAttribute('tabindex');
      trigger.removeAttribute('role');
      trigger.removeAttribute('aria-label');
      trigger.removeAttribute('aria-haspopup');
      trigger.removeAttribute('aria-controls');
    });
    if (activeTeardown === teardown) activeTeardown = null;
  }

  activeTeardown = teardown;
  return teardown;
}
