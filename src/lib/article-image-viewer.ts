import {
  ARTICLE_IMAGE_MAX_SCALE,
  ARTICLE_IMAGE_MIN_SCALE,
  clampArticleImageTransform,
  classifyArticleImage,
  getArticleImageSourceAction,
  zoomArticleImageTransformAtPoint,
  type ArticleImageKind, type ArticleImagePoint,
  type ArticleImageTransform, type ArticleImageViewport
} from './article-images';
const IMAGE_KINDS: readonly ArticleImageKind[] = ['landscape', 'square', 'portrait', 'long'];
type PointerState = ArticleImagePoint & { startX: number; startY: number };
type ViewerElements = {
  dialog: HTMLDialogElement; stage: HTMLElement; image: HTMLImageElement;
  caption: HTMLElement; close: HTMLButtonElement; zoomOut: HTMLButtonElement;
  reset: HTMLButtonElement; zoomIn: HTMLButtonElement; source: HTMLAnchorElement;
};
type ScrollLock = { x: number; y: number; cssText: string };
type ElementConstructor<T extends Element> = { new (): T };
let activeTeardown: (() => void) | null = null;
function queryElement<T extends Element>(
  root: ParentNode,
  selector: string,
  Type: ElementConstructor<T>
): T | null {
  const element = root.querySelector(selector);
  return element instanceof Type ? element : null;
}
function getElements(root: ParentNode): ViewerElements | null {
  const dialog = queryElement(root, '[data-article-image-viewer]', HTMLDialogElement);
  if (!dialog || typeof dialog.showModal !== 'function') return null;
  const stage = queryElement(dialog, '[data-viewer-stage]', HTMLElement);
  const image = queryElement(dialog, '[data-viewer-image]', HTMLImageElement);
  const caption = queryElement(dialog, '[data-viewer-caption]', HTMLElement);
  const close = queryElement(dialog, '[data-viewer-close]', HTMLButtonElement);
  const zoomOut = queryElement(dialog, '[data-viewer-zoom-out]', HTMLButtonElement);
  const reset = queryElement(dialog, '[data-viewer-reset]', HTMLButtonElement);
  const zoomIn = queryElement(dialog, '[data-viewer-zoom-in]', HTMLButtonElement);
  const source = queryElement(dialog, '[data-viewer-source]', HTMLAnchorElement);
  if (!stage || !image || !caption || !close || !zoomOut || !reset || !zoomIn || !source) {
    return null;
  }
  return { dialog, stage, image, caption, close, zoomOut, reset, zoomIn, source };
}
function imageSource(image: HTMLImageElement): string {
  return image.getAttribute('src')?.trim() ?? '';
}
function classifyImage(image: HTMLImageElement): void {
  IMAGE_KINDS.forEach((kind) => image.classList.remove(`article-image--${kind}`));
  const kind = classifyArticleImage(image.naturalWidth, image.naturalHeight);
  if (kind) image.classList.add(`article-image--${kind}`);
}
function midpoint(first: ArticleImagePoint, second: ArticleImagePoint): ArticleImagePoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}
function distance(first: ArticleImagePoint, second: ArticleImagePoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}
export function bindArticleImageViewer(root: ParentNode = document): () => void {
  activeTeardown?.();
  activeTeardown = null;
  const article = queryElement(root, '[data-article-images="true"]', HTMLElement);
  const elements = getElements(root);
  if (!article || !elements) return () => undefined;
  const { dialog, stage, image: viewerImage, caption, close, zoomOut, reset, zoomIn, source } =
    elements;
  const controller = new AbortController();
  const { signal } = controller;
  const pointers = new Map<number, PointerState>();
  const enhancedImages = new Set<HTMLImageElement>();
  let transform: ArticleImageTransform = { scale: ARTICLE_IMAGE_MIN_SCALE, x: 0, y: 0 };
  let activeImage: HTMLImageElement | null = null;
  let scrollLock: ScrollLock | null = null;
  let openFrame = 0;
  let resizeFrame = 0;
  let gestureMoved = false;
  let suppressBackdropUntil = 0;
  let disposed = false;
  function viewport(): ArticleImageViewport {
    return {
      baseWidth: viewerImage.offsetWidth,
      baseHeight: viewerImage.offsetHeight,
      viewportWidth: stage.clientWidth,
      viewportHeight: stage.clientHeight
    };
  }
  function applyTransform(): void {
    transform = clampArticleImageTransform(transform, viewport());
    viewerImage.style.transform =
      `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`;
    const zoomed = transform.scale > ARTICLE_IMAGE_MIN_SCALE + 0.001;
    stage.classList.toggle('sc-image-viewer-stage-zoomed', zoomed);
    zoomOut.disabled = !zoomed;
    reset.disabled = !zoomed && transform.x === 0 && transform.y === 0;
    zoomIn.disabled = transform.scale >= ARTICLE_IMAGE_MAX_SCALE - 0.001;
  }
  function resetTransform(): void {
    transform = { scale: ARTICLE_IMAGE_MIN_SCALE, x: 0, y: 0 };
    applyTransform();
  }
  function stagePoint(clientX: number, clientY: number): ArticleImagePoint {
    const bounds = stage.getBoundingClientRect();
    return {
      x: clientX - bounds.left - bounds.width / 2,
      y: clientY - bounds.top - bounds.height / 2
    };
  }
  function zoomTo(scale: number, point: ArticleImagePoint = { x: 0, y: 0 }): void {
    transform = zoomArticleImageTransformAtPoint(transform, scale, point, viewport());
    applyTransform();
  }
  function cancelFrames(): void {
    if (openFrame) window.cancelAnimationFrame(openFrame);
    if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
    openFrame = 0;
    resizeFrame = 0;
  }
  function lockScroll(): void {
    const body = document.body;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const paddingRight = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    scrollLock = { x: window.scrollX, y: window.scrollY, cssText: body.style.cssText };
    Object.assign(body.style, {
      position: 'fixed',
      top: `${-scrollLock.y}px`,
      left: `${-scrollLock.x}px`,
      width: '100%',
      overflow: 'hidden'
    });
    if (scrollbarWidth) body.style.paddingRight = `${paddingRight + scrollbarWidth}px`;
  }
  function unlockScroll(): void {
    if (!scrollLock) return;
    const saved = scrollLock;
    scrollLock = null;
    document.body.style.cssText = saved.cssText;
    window.scrollTo(saved.x, saved.y);
  }
  function configureSource(trigger: HTMLImageElement): string | null {
    const rawSource = imageSource(trigger);
    const action = getArticleImageSourceAction(rawSource, window.location.href);
    if (!action) return null;
    const download = action.kind === 'download';
    source.href = action.href;
    source.hidden = false;
    source.textContent = download ? '下载原图' : '打开原图';
    source.setAttribute('aria-label', source.textContent);
    source.toggleAttribute('download', download);
    if (download) {
      source.removeAttribute('target');
      source.removeAttribute('rel');
    } else {
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
    }
    const displayUrl = new URL(rawSource, window.location.href);
    if (download) displayUrl.searchParams.delete('download');
    return displayUrl.href;
  }
  function openViewer(trigger: HTMLImageElement): void {
    if (dialog.open) return;
    const displaySource = configureSource(trigger);
    if (!displaySource) return;
    activeImage = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    viewerImage.src = displaySource;
    viewerImage.alt = trigger.alt;
    const description = trigger.title.trim() || trigger.alt.trim();
    caption.textContent = description;
    caption.hidden = !description;
    lockScroll();
    try {
      dialog.showModal();
    } catch {
      trigger.setAttribute('aria-expanded', 'false');
      activeImage = null;
      viewerImage.removeAttribute('src');
      unlockScroll();
      return;
    }
    openFrame = window.requestAnimationFrame(() => {
      openFrame = 0;
      if (!dialog.open) return;
      resetTransform();
      close.focus({ preventScroll: true });
    });
  }
  function closeViewer(): void {
    cancelFrames();
    if (dialog.open) dialog.close();
  }
  function syncDragging(): void {
    const dragging = pointers.size > 0 &&
      (transform.scale > ARTICLE_IMAGE_MIN_SCALE || pointers.size > 1);
    stage.classList.toggle('sc-image-viewer-stage-dragging', dragging);
  }
  function dropPointer(event: PointerEvent): void {
    pointers.delete(event.pointerId);
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    syncDragging();
  }
  const validImages = Array.from(article.querySelectorAll('img')).filter(
    (candidate): candidate is HTMLImageElement =>
      candidate instanceof HTMLImageElement &&
      getArticleImageSourceAction(imageSource(candidate), window.location.href) !== null
  );
  validImages.forEach((trigger) => {
    enhancedImages.add(trigger);
    trigger.tabIndex = 0;
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', dialog.id);
    trigger.setAttribute('aria-expanded', 'false');
    if (trigger.complete) classifyImage(trigger);
  });

  article.addEventListener(
    'load',
    (event) => {
      const trigger = event.target;
      if (trigger instanceof HTMLImageElement && enhancedImages.has(trigger)) {
        classifyImage(trigger);
      }
    },
    { capture: true, signal }
  );

  article.addEventListener(
    'click',
    (event) => {
      const trigger = event.target;
      if (
        !(trigger instanceof HTMLImageElement) ||
        !enhancedImages.has(trigger) ||
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openViewer(trigger);
    },
    { signal }
  );

  article.addEventListener(
    'keydown',
    (event) => {
      const trigger = event.target;
      if (
        !(trigger instanceof HTMLImageElement) ||
        !enhancedImages.has(trigger) ||
        (event.key !== 'Enter' && event.key !== ' ')
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openViewer(trigger);
    },
    { signal }
  );

  close.addEventListener('click', closeViewer, { signal });
  zoomOut.addEventListener(
    'click',
    () =>
      zoomTo(
        transform.scale <= 1.5 ? ARTICLE_IMAGE_MIN_SCALE : transform.scale / 1.5
      ),
    { signal }
  );
  reset.addEventListener('click', resetTransform, { signal });
  zoomIn.addEventListener('click', () => zoomTo(transform.scale * 1.5), { signal });

  dialog.addEventListener(
    'cancel',
    (event) => {
      event.preventDefault();
      closeViewer();
    },
    { signal }
  );
  dialog.addEventListener(
    'close',
    () => {
      cancelFrames();
      pointers.clear();
      stage.classList.remove('sc-image-viewer-stage-dragging');
      resetTransform();
      unlockScroll();
      if (activeImage) {
        activeImage.setAttribute('aria-expanded', 'false');
        activeImage.focus({ preventScroll: true });
      }
      activeImage = null;
      viewerImage.removeAttribute('src');
      viewerImage.alt = '';
      caption.textContent = '';
      caption.hidden = true;
    },
    { signal }
  );
  dialog.addEventListener(
    'click',
    (event) => {
      if (
        (event.target === dialog || event.target === stage) &&
        performance.now() >= suppressBackdropUntil
      ) {
        closeViewer();
      }
    },
    { signal }
  );

  viewerImage.addEventListener('load', () => dialog.open && resetTransform(), { signal });
  viewerImage.addEventListener('dragstart', (event) => event.preventDefault(), { signal });
  stage.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const multiplier =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? stage.clientHeight
            : 1;
      zoomTo(
        transform.scale * Math.exp(-event.deltaY * multiplier * 0.002),
        stagePoint(event.clientX, event.clientY)
      );
    },
    { passive: false, signal }
  );

  stage.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (pointers.size === 0) gestureMoved = false;
      pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY
      });
      gestureMoved ||= pointers.size > 1;
      stage.setPointerCapture(event.pointerId);
      syncDragging();
      event.preventDefault();
    },
    { signal }
  );

  stage.addEventListener(
    'pointermove',
    (event) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;

      const before = [...pointers.values()].map((pointer) => ({ ...pointer }));
      const current = { ...previous, x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, current);
      gestureMoved ||= Math.hypot(current.x - current.startX, current.y - current.startY) > 5;
      const after = [...pointers.values()];

      if (before.length >= 2 && after.length >= 2) {
        const beforeDistance = distance(before[0], before[1]);
        const afterDistance = distance(after[0], after[1]);

        if (beforeDistance > 0 && afterDistance > 0) {
          const beforeMiddle = midpoint(before[0], before[1]);
          const afterMiddle = midpoint(after[0], after[1]);
          transform = zoomArticleImageTransformAtPoint(
            transform,
            transform.scale * (afterDistance / beforeDistance),
            stagePoint(beforeMiddle.x, beforeMiddle.y),
            viewport()
          );
          transform = clampArticleImageTransform(
            {
              ...transform,
              x: transform.x + afterMiddle.x - beforeMiddle.x,
              y: transform.y + afterMiddle.y - beforeMiddle.y
            },
            viewport()
          );
          applyTransform();
        }
      } else if (transform.scale > ARTICLE_IMAGE_MIN_SCALE) {
        transform = clampArticleImageTransform(
          {
            ...transform,
            x: transform.x + event.clientX - previous.x,
            y: transform.y + event.clientY - previous.y
          },
          viewport()
        );
        applyTransform();
      }
      event.preventDefault();
    },
    { signal }
  );

  stage.addEventListener(
    'pointerup',
    (event) => {
      dropPointer(event);
      if (gestureMoved) suppressBackdropUntil = performance.now() + 150;
    },
    { signal }
  );
  stage.addEventListener(
    'pointercancel',
    (event) => {
      dropPointer(event);
      suppressBackdropUntil = performance.now() + 150;
    },
    { signal }
  );

  function scheduleResize(): void {
    if (!dialog.open || resizeFrame) return;
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      if (dialog.open) applyTransform();
    });
  }

  window.addEventListener('resize', scheduleResize, { signal });
  window.visualViewport?.addEventListener('resize', scheduleResize, { signal });

  const teardown = () => {
    if (disposed) return;
    disposed = true;
    closeViewer();
    controller.abort();
    cancelFrames();
    unlockScroll();
    validImages.forEach((trigger) => {
      trigger.removeAttribute('tabindex');
      trigger.removeAttribute('role');
      trigger.removeAttribute('aria-haspopup');
      trigger.removeAttribute('aria-controls');
      trigger.removeAttribute('aria-expanded');
    });
    if (activeTeardown === teardown) activeTeardown = null;
  };

  activeTeardown = teardown;
  return teardown;
}
