export const ARTICLE_IMAGE_VIEWER_FIT_ZOOM = 1;
export const ARTICLE_IMAGE_VIEWER_MIN_ZOOM = ARTICLE_IMAGE_VIEWER_FIT_ZOOM;
export const ARTICLE_IMAGE_VIEWER_SECONDARY_ZOOM = 2.5;
export const ARTICLE_IMAGE_VIEWER_MAX_ZOOM = 4;

export type ArticleImageViewerTransform = { zoom: number; panX: number; panY: number };
export type ArticleImageViewerPoint = { x: number; y: number };
export type ArticleImageViewerBounds = {
  imageWidth: number;
  imageHeight: number;
  stageWidth: number;
  stageHeight: number;
};
export type ArticleImageViewerPanBounds = { maximumX: number; maximumY: number };
export type ArticleImageViewerPinch = {
  initialDistance: number;
  initialZoom: number;
  initialCenter: ArticleImageViewerPoint;
  initialPanX: number;
  initialPanY: number;
};
export type ArticleImageViewerSourceCandidate = {
  dataFullSource?: string | null;
  linkHref?: string | null;
  linkIsExplicit?: boolean;
  currentSource?: string | null;
  source?: string | null;
};
export type ArticleImageViewerSelectionCandidate = {
  excluded: boolean;
  hidden: boolean;
  presentational: boolean;
  decorative: boolean;
  insideInteractiveControl: boolean;
  semanticUiImage: boolean;
  trackingPixel: boolean;
  explicit: boolean;
  linkedToNonImage: boolean;
  hasSource: boolean;
};
export type ArticleImageViewerAttributeSnapshot = Record<string, string | null>;
export type ArticleImageViewerGestureMode = 'idle' | 'pressing' | 'dragging' | 'pinching' | 'swiping';
export type ArticleImageViewerTransientInteractionState = {
  ignoreNativeDoubleClickUntil: number;
  suppressClickUntil: number;
  suppressClickPoint: ArticleImageViewerPoint | null;
  lastTap: { time: number; point: ArticleImageViewerPoint } | null;
  singleStart: ArticleImageViewerPoint;
  singlePointerType: string;
  gestureMode: ArticleImageViewerGestureMode;
  gestureMoved: boolean;
  gestureHadMultiplePointers: boolean;
};

type AttributeHost = {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};
type ViewerItem = {
  element: HTMLImageElement;
  source: string;
  caption: string;
  alt: string;
};
type ViewerElements = {
  dialog: HTMLDialogElement;
  backdrop: HTMLElement;
  stage: HTMLElement;
  image: HTMLImageElement;
  status: HTMLElement;
  close: HTMLButtonElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  count: HTMLOutputElement;
  zoom: HTMLButtonElement;
  original: HTMLAnchorElement;
  caption: HTMLElement;
  hint: HTMLElement;
};
type StyleSnapshot = { value: string; priority: string; appliedValue: string };
type ScrollLock = {
  x: number;
  y: number;
  properties: Map<string, StyleSnapshot>;
};
type LoadToken = { generation: number; index: number };

const ENHANCED_ATTRIBUTES = ['tabindex', 'role', 'aria-label', 'aria-haspopup', 'aria-controls'] as const;
const IMAGE_EXTENSION_PATTERN = /\.(?:jpe?g|png|gif|webp|avif|svg)$/i;
const GESTURE_MOVE_THRESHOLD = 7;
const SWIPE_DISTANCE_THRESHOLD = 60;
const DOUBLE_TAP_DELAY = 320;
const DOUBLE_TAP_DISTANCE = 32;
const LOAD_TIMEOUT = 15_000;
const BODY_LOCK_PROPERTIES = ['position', 'top', 'left', 'right', 'width', 'overflow', 'padding-right'] as const;

let activeTeardown: (() => void) | null = null;

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function clampArticleImageViewerValue(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function getArticleImageViewerDistance(
  first: ArticleImageViewerPoint,
  second: ArticleImageViewerPoint
): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function getArticleImageViewerCenter(
  first: ArticleImageViewerPoint,
  second: ArticleImageViewerPoint
): ArticleImageViewerPoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

export function resetArticleImageViewerTransform(): ArticleImageViewerTransform {
  return { zoom: ARTICLE_IMAGE_VIEWER_FIT_ZOOM, panX: 0, panY: 0 };
}

export function getArticleImageViewerPanBounds(
  zoom: number,
  bounds: ArticleImageViewerBounds
): ArticleImageViewerPanBounds {
  const safeZoom = clampArticleImageViewerValue(
    finiteOrZero(zoom) || ARTICLE_IMAGE_VIEWER_FIT_ZOOM,
    ARTICLE_IMAGE_VIEWER_MIN_ZOOM,
    ARTICLE_IMAGE_VIEWER_MAX_ZOOM
  );
  const imageWidth = Math.max(0, finiteOrZero(bounds.imageWidth));
  const imageHeight = Math.max(0, finiteOrZero(bounds.imageHeight));
  const stageWidth = Math.max(0, finiteOrZero(bounds.stageWidth));
  const stageHeight = Math.max(0, finiteOrZero(bounds.stageHeight));

  return {
    maximumX: Math.max(0, (imageWidth * safeZoom - stageWidth) / 2),
    maximumY: Math.max(0, (imageHeight * safeZoom - stageHeight) / 2)
  };
}

export function constrainArticleImageViewerTransform(
  transform: ArticleImageViewerTransform,
  bounds: ArticleImageViewerBounds
): ArticleImageViewerTransform {
  const zoom = clampArticleImageViewerValue(
    finiteOrZero(transform.zoom) || ARTICLE_IMAGE_VIEWER_FIT_ZOOM,
    ARTICLE_IMAGE_VIEWER_MIN_ZOOM,
    ARTICLE_IMAGE_VIEWER_MAX_ZOOM
  );

  if (zoom <= ARTICLE_IMAGE_VIEWER_FIT_ZOOM) {
    return resetArticleImageViewerTransform();
  }

  const { maximumX, maximumY } = getArticleImageViewerPanBounds(zoom, bounds);
  return {
    zoom,
    panX: clampArticleImageViewerValue(finiteOrZero(transform.panX), -maximumX, maximumX),
    panY: clampArticleImageViewerValue(finiteOrZero(transform.panY), -maximumY, maximumY)
  };
}

export function panArticleImageViewerTransform(
  transform: ArticleImageViewerTransform,
  deltaX: number,
  deltaY: number,
  bounds: ArticleImageViewerBounds
): ArticleImageViewerTransform {
  const current = constrainArticleImageViewerTransform(transform, bounds);
  if (current.zoom <= ARTICLE_IMAGE_VIEWER_FIT_ZOOM) return current;

  return constrainArticleImageViewerTransform({
    ...current,
    panX: current.panX + finiteOrZero(deltaX),
    panY: current.panY + finiteOrZero(deltaY)
  }, bounds);
}

export function resizeArticleImageViewerTransform(
  transform: ArticleImageViewerTransform,
  previousBounds: ArticleImageViewerBounds,
  nextBounds: ArticleImageViewerBounds
): ArticleImageViewerTransform {
  if (transform.zoom <= ARTICLE_IMAGE_VIEWER_FIT_ZOOM) return resetArticleImageViewerTransform();
  const panX = previousBounds.imageWidth > 0
    ? transform.panX * nextBounds.imageWidth / previousBounds.imageWidth
    : transform.panX;
  const panY = previousBounds.imageHeight > 0
    ? transform.panY * nextBounds.imageHeight / previousBounds.imageHeight
    : transform.panY;
  return constrainArticleImageViewerTransform({ ...transform, panX, panY }, nextBounds);
}

export function zoomArticleImageViewerAtPoint(
  transform: ArticleImageViewerTransform,
  targetZoom: number,
  point: ArticleImageViewerPoint,
  bounds: ArticleImageViewerBounds
): ArticleImageViewerTransform {
  const current = constrainArticleImageViewerTransform(transform, bounds);
  const zoom = clampArticleImageViewerValue(
    Number.isFinite(targetZoom) ? targetZoom : current.zoom,
    ARTICLE_IMAGE_VIEWER_MIN_ZOOM,
    ARTICLE_IMAGE_VIEWER_MAX_ZOOM
  );

  if (zoom <= ARTICLE_IMAGE_VIEWER_FIT_ZOOM) return resetArticleImageViewerTransform();
  if (zoom === current.zoom) return current;

  const ratio = zoom / current.zoom;
  return constrainArticleImageViewerTransform({
    zoom,
    panX: finiteOrZero(point.x) - (finiteOrZero(point.x) - current.panX) * ratio,
    panY: finiteOrZero(point.y) - (finiteOrZero(point.y) - current.panY) * ratio
  }, bounds);
}

export function beginArticleImageViewerPinch(
  first: ArticleImageViewerPoint,
  second: ArticleImageViewerPoint,
  transform: ArticleImageViewerTransform
): ArticleImageViewerPinch | null {
  const initialDistance = getArticleImageViewerDistance(first, second);
  if (!Number.isFinite(initialDistance) || initialDistance <= 0) return null;

  return {
    initialDistance,
    initialZoom: transform.zoom,
    initialCenter: getArticleImageViewerCenter(first, second),
    initialPanX: transform.panX,
    initialPanY: transform.panY
  };
}

export function updateArticleImageViewerPinch(
  pinch: ArticleImageViewerPinch,
  first: ArticleImageViewerPoint,
  second: ArticleImageViewerPoint,
  bounds: ArticleImageViewerBounds
): ArticleImageViewerTransform {
  const distance = getArticleImageViewerDistance(first, second);
  if (!Number.isFinite(distance) || distance <= 0 || pinch.initialZoom <= 0) {
    return constrainArticleImageViewerTransform({
      zoom: pinch.initialZoom,
      panX: pinch.initialPanX,
      panY: pinch.initialPanY
    }, bounds);
  }

  const zoom = clampArticleImageViewerValue(
    pinch.initialZoom * distance / pinch.initialDistance,
    ARTICLE_IMAGE_VIEWER_MIN_ZOOM,
    ARTICLE_IMAGE_VIEWER_MAX_ZOOM
  );
  if (zoom <= ARTICLE_IMAGE_VIEWER_FIT_ZOOM) return resetArticleImageViewerTransform();

  const center = getArticleImageViewerCenter(first, second);
  const ratio = zoom / pinch.initialZoom;
  return constrainArticleImageViewerTransform({
    zoom,
    panX: center.x - (pinch.initialCenter.x - pinch.initialPanX) * ratio,
    panY: center.y - (pinch.initialCenter.y - pinch.initialPanY) * ratio
  }, bounds);
}

export function normalizeArticleImageViewerWheelDelta(
  deltaY: number,
  deltaMode: number,
  pageHeight: number
): number {
  const safeDelta = finiteOrZero(deltaY);
  if (deltaMode === 1) return safeDelta * 16;
  if (deltaMode === 2) return safeDelta * Math.max(1, finiteOrZero(pageHeight));
  return safeDelta;
}

export function getArticleImageViewerSwipeDirection(
  deltaX: number,
  deltaY: number,
  zoom: number,
  hadMultiplePointers: boolean
): -1 | 0 | 1 {
  if (zoom > ARTICLE_IMAGE_VIEWER_FIT_ZOOM || hadMultiplePointers) return 0;
  if (Math.abs(deltaX) < SWIPE_DISTANCE_THRESHOLD || Math.abs(deltaX) <= Math.abs(deltaY) * 1.35) return 0;
  return deltaX < 0 ? 1 : -1;
}

export function getArticleImageViewerRebasedGestureMode(
  pointerCount: number,
  zoom: number
): ArticleImageViewerGestureMode {
  if (pointerCount >= 2) return 'pinching';
  if (pointerCount === 1) return zoom > ARTICLE_IMAGE_VIEWER_FIT_ZOOM ? 'dragging' : 'pressing';
  return 'idle';
}

export function shouldSuppressArticleImageViewerClick(
  moved: boolean,
  hadMultiplePointers: boolean,
  cancelled: boolean,
  mode: ArticleImageViewerGestureMode
): boolean {
  return moved || hadMultiplePointers || cancelled || mode === 'dragging' || mode === 'pinching' || mode === 'swiping';
}

export function resetArticleImageViewerTransientInteractionState(): ArticleImageViewerTransientInteractionState {
  return {
    ignoreNativeDoubleClickUntil: 0,
    suppressClickUntil: 0,
    suppressClickPoint: null,
    lastTap: null,
    singleStart: { x: 0, y: 0 },
    singlePointerType: '',
    gestureMode: 'idle',
    gestureMoved: false,
    gestureHadMultiplePointers: false
  };
}

export function getArticleImageViewerNavigationState(index: number, length: number): {
  hidden: boolean;
  previousDisabled: boolean;
  nextDisabled: boolean;
} {
  return {
    hidden: length <= 1,
    previousDisabled: index <= 0,
    nextDisabled: index < 0 || index >= length - 1
  };
}

function normalizeHttpSource(source: string | null | undefined, baseUrl: string): string | null {
  const value = source?.trim();
  if (!value) return null;

  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function isArticleImageViewerImageResourceUrl(source: string, baseUrl: string): boolean {
  const normalized = normalizeHttpSource(source, baseUrl);
  if (!normalized) return false;

  const url = new URL(normalized);
  return IMAGE_EXTENSION_PATTERN.test(url.pathname) || /^\/i\/[^/]+/i.test(url.pathname);
}

export function resolveArticleImageViewerSource(
  candidate: ArticleImageViewerSourceCandidate,
  baseUrl: string
): string | null {
  const fullSource = normalizeHttpSource(candidate.dataFullSource, baseUrl);
  if (fullSource) return fullSource;

  if (
    candidate.linkHref &&
    (candidate.linkIsExplicit || isArticleImageViewerImageResourceUrl(candidate.linkHref, baseUrl))
  ) {
    const linkSource = normalizeHttpSource(candidate.linkHref, baseUrl);
    if (linkSource) return linkSource;
  }

  return normalizeHttpSource(candidate.currentSource, baseUrl) ?? normalizeHttpSource(candidate.source, baseUrl);
}

export function shouldEnhanceArticleImageViewerCandidate(
  candidate: ArticleImageViewerSelectionCandidate
): boolean {
  if (candidate.excluded || candidate.hidden || candidate.presentational || !candidate.hasSource) return false;
  if (candidate.explicit) return true;
  return !candidate.decorative && !candidate.insideInteractiveControl && !candidate.semanticUiImage &&
    !candidate.trackingPixel && !candidate.linkedToNonImage;
}

export function resolveArticleImageViewerCaption(candidate: {
  figureCaption?: string | null;
  adjacentCaption?: string | null;
  title?: string | null;
  alt?: string | null;
}): string {
  return candidate.figureCaption?.trim() || candidate.adjacentCaption?.trim() ||
    candidate.title?.trim() || candidate.alt?.trim() || '';
}

export function captureArticleImageViewerAttributes(element: AttributeHost): ArticleImageViewerAttributeSnapshot {
  return Object.fromEntries(ENHANCED_ATTRIBUTES.map((name) => [name, element.getAttribute(name)]));
}

export function restoreArticleImageViewerAttributes(
  element: AttributeHost,
  snapshot: ArticleImageViewerAttributeSnapshot
): void {
  for (const name of ENHANCED_ATTRIBUTES) {
    const value = snapshot[name];
    if (value === null || value === undefined) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }
}

export function getArticleImageViewerAccessibleLabel(alt: string, caption: string): string {
  const description = alt.trim() || caption.trim();
  return description ? `查看大图：${description}` : '查看大图';
}

export class ArticleImageViewerRequestTracker {
  private generation = 0;
  private active = false;

  activate(): void {
    this.active = true;
    this.generation += 1;
  }

  begin(index: number): LoadToken {
    this.active = true;
    return { generation: ++this.generation, index };
  }

  invalidate(): void {
    this.active = false;
    this.generation += 1;
  }

  isCurrent(token: LoadToken, index: number): boolean {
    return this.active && token.generation === this.generation && token.index === index;
  }
}

function resolveCaption(image: HTMLImageElement): string {
  const figureCaption = image.closest('figure')?.querySelector('figcaption')?.textContent?.trim();
  const imageBlock = image.closest('.sc-prose-image-paragraph, p');
  const adjacentCaption = imageBlock?.nextElementSibling;
  const adjacentText = adjacentCaption?.classList.contains('sc-prose-image-caption')
    ? adjacentCaption.textContent
    : null;
  return resolveArticleImageViewerCaption({
    figureCaption,
    adjacentCaption: adjacentText,
    title: image.getAttribute('title'),
    alt: image.getAttribute('alt')
  });
}

function isExplicitlyEnabled(image: HTMLImageElement): boolean {
  return image.hasAttribute('data-image-viewer') || image.closest('[data-image-viewer]') !== null;
}

function shouldEnhanceImage(image: HTMLImageElement, baseUrl: string): boolean {
  const explicit = isExplicitlyEnabled(image) || image.hasAttribute('data-full-src');
  const role = image.getAttribute('role')?.toLowerCase();
  const semanticText = `${image.className} ${image.getAttribute('data-type') ?? ''}`.toLowerCase();
  const width = Number.parseFloat(image.getAttribute('width') ?? '');
  const height = Number.parseFloat(image.getAttribute('height') ?? '');
  const link = image.closest('a[href]');
  const hasExplicitSource = image.hasAttribute('data-full-src');
  const source = resolveArticleImageViewerSource({
    dataFullSource: image.getAttribute('data-full-src'),
    linkHref: link?.getAttribute('href'),
    linkIsExplicit: Boolean(link?.hasAttribute('data-original-image') || link?.hasAttribute('data-full-src')),
    currentSource: image.currentSrc,
    source: image.getAttribute('src')
  }, baseUrl);

  return shouldEnhanceArticleImageViewerCandidate({
    excluded: image.closest('[data-no-image-viewer]') !== null,
    hidden: image.getAttribute('aria-hidden') === 'true',
    presentational: role === 'presentation' || role === 'none',
    decorative: image.hasAttribute('alt') && !image.getAttribute('alt')?.trim(),
    insideInteractiveControl: image.closest('button, [role="button"]') !== null,
    semanticUiImage: /(?:^|[\s_-])(emoji|emoticon|avatar|icon|logo|badge)(?:$|[\s_-])/.test(semanticText),
    trackingPixel: width > 0 && height > 0 && width <= 2 && height <= 2,
    explicit,
    linkedToNonImage: Boolean(
      link && !hasExplicitSource &&
      !isArticleImageViewerImageResourceUrl(link.getAttribute('href') ?? '', baseUrl)
    ),
    hasSource: source !== null
  });
}

function collectViewerImages(article: HTMLElement): ViewerItem[] {
  const baseUrl = window.location.href;
  const items: ViewerItem[] = [];

  for (const candidate of article.querySelectorAll('img')) {
    if (!(candidate instanceof HTMLImageElement) || !shouldEnhanceImage(candidate, baseUrl)) continue;
    const link = candidate.closest('a[href]');
    const source = resolveArticleImageViewerSource({
      dataFullSource: candidate.getAttribute('data-full-src'),
      linkHref: link?.getAttribute('href'),
      linkIsExplicit: Boolean(link?.hasAttribute('data-original-image') || link?.hasAttribute('data-full-src')),
      currentSource: candidate.currentSrc,
      source: candidate.getAttribute('src')
    }, baseUrl);
    if (!source) continue;

    items.push({
      element: candidate,
      source,
      caption: resolveCaption(candidate),
      alt: candidate.getAttribute('alt')?.trim() || ''
    });
  }

  return items;
}

function getElements(root: ParentNode): ViewerElements | null {
  const dialog = root.querySelector('[data-article-image-viewer]');
  if (!(dialog instanceof HTMLDialogElement) || typeof dialog.showModal !== 'function') return null;

  const backdrop = dialog.querySelector<HTMLElement>('[data-viewer-backdrop]');
  const stage = dialog.querySelector<HTMLElement>('[data-viewer-stage]');
  const image = dialog.querySelector<HTMLImageElement>('[data-viewer-image]');
  const status = dialog.querySelector<HTMLElement>('[data-viewer-status]');
  const close = dialog.querySelector<HTMLButtonElement>('[data-viewer-close]');
  const previous = dialog.querySelector<HTMLButtonElement>('[data-viewer-prev]');
  const next = dialog.querySelector<HTMLButtonElement>('[data-viewer-next]');
  const count = dialog.querySelector<HTMLOutputElement>('[data-viewer-count]');
  const zoom = dialog.querySelector<HTMLButtonElement>('[data-viewer-zoom]');
  const original = dialog.querySelector<HTMLAnchorElement>('[data-viewer-original]');
  const caption = dialog.querySelector<HTMLElement>('[data-viewer-caption]');
  const hint = dialog.querySelector<HTMLElement>('[data-viewer-hint]');

  if (!backdrop || !stage || !image || !status || !close || !previous || !next || !count || !zoom || !original || !caption || !hint) {
    return null;
  }
  return { dialog, backdrop, stage, image, status, close, previous, next, count, zoom, original, caption, hint };
}

function setLockedStyle(body: HTMLElement, lock: ScrollLock, property: string, value: string): void {
  lock.properties.set(property, {
    value: body.style.getPropertyValue(property),
    priority: body.style.getPropertyPriority(property),
    appliedValue: value
  });
  body.style.setProperty(property, value);
}

export function bindArticleImageViewer(root: ParentNode = document): () => void {
  activeTeardown?.();
  activeTeardown = null;

  const article = root.querySelector('[data-article-image-viewer-root]');
  const elements = getElements(root);
  if (!(article instanceof HTMLElement) || !elements) return () => undefined;

  const { dialog, backdrop, stage, image, status, close, previous, next, count, zoom, original, caption, hint } = elements;
  const controller = new AbortController();
  const { signal } = controller;
  const items = collectViewerImages(article);
  const originalAttributes = new Map<HTMLImageElement, ArticleImageViewerAttributeSnapshot>();
  const activePointers = new Map<number, ArticleImageViewerPoint>();
  const requestTracker = new ArticleImageViewerRequestTracker();

  let transform = resetArticleImageViewerTransform();
  let geometry: ArticleImageViewerBounds = { imageWidth: 0, imageHeight: 0, stageWidth: 0, stageHeight: 0 };
  let stageRect = { left: 0, top: 0, width: 0, height: 0 };
  let currentIndex = -1;
  let opener: HTMLImageElement | null = null;
  let gestureMode: ArticleImageViewerGestureMode = 'idle';
  let primaryPointerId: number | null = null;
  let pinchPointerIds: [number, number] | null = null;
  let pinch: ArticleImageViewerPinch | null = null;
  let singleStart: ArticleImageViewerPoint = { x: 0, y: 0 };
  let singlePointerType = '';
  let gestureMoved = false;
  let gestureHadMultiplePointers = false;
  let lastTap: { time: number; point: ArticleImageViewerPoint } | null = null;
  let ignoreNativeDoubleClickUntil = 0;
  let suppressClickUntil = 0;
  let suppressClickPoint: ArticleImageViewerPoint | null = null;
  let scrollLock: ScrollLock | null = null;
  let renderFrame = 0;
  let resizeFrame = 0;
  let wheelFrame = 0;
  let pendingWheelLog = 0;
  let wheelPoint: ArticleImageViewerPoint = { x: 0, y: 0 };
  let hintTimer = 0;
  let hintShown = false;
  let loadTimer = 0;
  let loadCleanup: (() => void) | null = null;
  let disposed = false;

  function refreshGeometry(): void {
    const rect = stage.getBoundingClientRect();
    stageRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    geometry = {
      imageWidth: image.offsetWidth,
      imageHeight: image.offsetHeight,
      stageWidth: rect.width,
      stageHeight: rect.height
    };
  }

  function pointInStage(point: ArticleImageViewerPoint): ArticleImageViewerPoint {
    return {
      x: point.x - stageRect.left - stageRect.width / 2,
      y: point.y - stageRect.top - stageRect.height / 2
    };
  }

  function renderTransform(): void {
    renderFrame = 0;
    transform = constrainArticleImageViewerTransform(transform, geometry);
    image.style.transform = `translate3d(${transform.panX}px, ${transform.panY}px, 0) scale(${transform.zoom})`;
    const zoomed = transform.zoom > ARTICLE_IMAGE_VIEWER_FIT_ZOOM;
    dialog.classList.toggle('sc-viewer-is-zoomed', zoomed);
    stage.classList.toggle('sc-image-viewer-stage-zoomed', zoomed);
    zoom.setAttribute('aria-label', zoomed ? '恢复适合屏幕' : '放大图片');
  }

  function scheduleRender(): void {
    if (!renderFrame) renderFrame = window.requestAnimationFrame(renderTransform);
  }

  function updateTransform(next: ArticleImageViewerTransform): void {
    transform = constrainArticleImageViewerTransform(next, geometry);
    scheduleRender();
  }

  function resetTransform(): void {
    transform = resetArticleImageViewerTransform();
    scheduleRender();
  }

  function updateNavigation(): void {
    const navigation = getArticleImageViewerNavigationState(currentIndex, items.length);
    previous.hidden = navigation.hidden;
    next.hidden = navigation.hidden;
    previous.disabled = navigation.previousDisabled;
    next.disabled = navigation.nextDisabled;
    count.hidden = navigation.hidden;
    count.value = navigation.hidden ? '' : `${currentIndex + 1} / ${items.length}`;
    count.textContent = count.value;
  }

  function hideHint(): void {
    if (hintTimer) window.clearTimeout(hintTimer);
    hintTimer = 0;
    hint.classList.remove('sc-viewer-hint-visible');
  }

  function showHintOnce(): void {
    if (hintShown) return;
    hintShown = true;
    hint.classList.add('sc-viewer-hint-visible');
    hintTimer = window.setTimeout(hideHint, 2600);
  }

  function markClickSuppressed(point?: ArticleImageViewerPoint): void {
    suppressClickUntil = performance.now() + 450;
    suppressClickPoint = point ?? null;
  }

  function isBackdropClickSuppressed(event: MouseEvent): boolean {
    if (performance.now() > suppressClickUntil) return false;
    if (!suppressClickPoint) return true;
    return getArticleImageViewerDistance(suppressClickPoint, { x: event.clientX, y: event.clientY }) < 100;
  }

  function resetTransientInteractionState(): void {
    const reset = resetArticleImageViewerTransientInteractionState();
    ignoreNativeDoubleClickUntil = reset.ignoreNativeDoubleClickUntil;
    suppressClickUntil = reset.suppressClickUntil;
    suppressClickPoint = reset.suppressClickPoint;
    lastTap = reset.lastTap;
    singleStart = reset.singleStart;
    singlePointerType = reset.singlePointerType;
    gestureMode = reset.gestureMode;
    gestureMoved = reset.gestureMoved;
    gestureHadMultiplePointers = reset.gestureHadMultiplePointers;
  }

  function releasePointerCapture(pointerId: number): void {
    if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
  }

  function stopPointerInteraction(releaseCaptures = true): void {
    const pointerIds = [...activePointers.keys()];
    activePointers.clear();
    if (releaseCaptures) {
      for (const pointerId of pointerIds) releasePointerCapture(pointerId);
    }
    primaryPointerId = null;
    pinchPointerIds = null;
    pinch = null;
    gestureMode = 'idle';
    gestureMoved = false;
    gestureHadMultiplePointers = false;
    stage.classList.remove('sc-image-viewer-stage-dragging');
  }

  function startSinglePointer(pointerId: number, point: ArticleImageViewerPoint, preserveMultiple = false): void {
    primaryPointerId = pointerId;
    pinchPointerIds = null;
    pinch = null;
    singleStart = point;
    gestureMoved = preserveMultiple;
    gestureHadMultiplePointers = preserveMultiple;
    gestureMode = preserveMultiple
      ? getArticleImageViewerRebasedGestureMode(1, transform.zoom)
      : 'pressing';
    stage.classList.toggle('sc-image-viewer-stage-dragging', gestureMode === 'dragging');
  }

  function startPinch(): void {
    if (activePointers.size < 2) return;
    const ids = [...activePointers.keys()].slice(0, 2) as [number, number];
    const first = activePointers.get(ids[0]);
    const second = activePointers.get(ids[1]);
    if (!first || !second) return;

    pinchPointerIds = ids;
    pinch = beginArticleImageViewerPinch(pointInStage(first), pointInStage(second), transform);
    primaryPointerId = null;
    gestureMode = getArticleImageViewerRebasedGestureMode(activePointers.size, transform.zoom);
    gestureMoved = true;
    gestureHadMultiplePointers = true;
    lastTap = null;
    stage.classList.add('sc-image-viewer-stage-dragging');
    markClickSuppressed(getArticleImageViewerCenter(first, second));
  }

  function rebasePointerInteraction(): void {
    pinch = null;
    pinchPointerIds = null;
    primaryPointerId = null;
    stage.classList.remove('sc-image-viewer-stage-dragging');

    if (activePointers.size >= 2) {
      startPinch();
      return;
    }

    const remaining = activePointers.entries().next().value as [number, ArticleImageViewerPoint] | undefined;
    if (remaining) startSinglePointer(remaining[0], remaining[1], true);
    else gestureMode = 'idle';
  }

  function toggleZoomAt(point: ArticleImageViewerPoint): void {
    hideHint();
    const target = transform.zoom > ARTICLE_IMAGE_VIEWER_FIT_ZOOM
      ? ARTICLE_IMAGE_VIEWER_FIT_ZOOM
      : ARTICLE_IMAGE_VIEWER_SECONDARY_ZOOM;
    updateTransform(zoomArticleImageViewerAtPoint(transform, target, pointInStage(point), geometry));
  }

  function registerTouchTap(point: ArticleImageViewerPoint): void {
    const now = performance.now();
    if (
      lastTap && now - lastTap.time <= DOUBLE_TAP_DELAY &&
      getArticleImageViewerDistance(lastTap.point, point) <= DOUBLE_TAP_DISTANCE
    ) {
      lastTap = null;
      ignoreNativeDoubleClickUntil = now + 500;
      markClickSuppressed(point);
      toggleZoomAt(point);
      return;
    }
    lastTap = { time: now, point };
  }

  function finishPointer(pointerId: number, cancelled: boolean): void {
    const point = activePointers.get(pointerId);
    if (!point) return;

    const wasLastPointer = activePointers.size === 1;
    const wasPinchPointer = pinchPointerIds?.includes(pointerId) ?? false;
    if (shouldSuppressArticleImageViewerClick(gestureMoved, gestureHadMultiplePointers, cancelled, gestureMode)) {
      markClickSuppressed(point);
    }

    if (wasLastPointer && !cancelled && !gestureHadMultiplePointers) {
      if (gestureMode === 'swiping') {
        const direction = getArticleImageViewerSwipeDirection(
          point.x - singleStart.x,
          point.y - singleStart.y,
          transform.zoom,
          false
        );
        if (direction !== 0) navigate(direction);
      } else if (gestureMode === 'pressing' && !gestureMoved && singlePointerType !== 'mouse') {
        registerTouchTap(point);
      }
    }

    activePointers.delete(pointerId);
    releasePointerCapture(pointerId);

    if (activePointers.size === 0) {
      primaryPointerId = null;
      pinchPointerIds = null;
      pinch = null;
      gestureMode = 'idle';
      gestureMoved = false;
      gestureHadMultiplePointers = false;
      stage.classList.remove('sc-image-viewer-stage-dragging');
      return;
    }

    if (wasPinchPointer || activePointers.size < 2) rebasePointerInteraction();
  }

  function cancelLoad(): void {
    if (loadTimer) window.clearTimeout(loadTimer);
    loadTimer = 0;
    loadCleanup?.();
    loadCleanup = null;
  }

  function setLoadState(state: 'loading' | 'ready' | 'error'): void {
    dialog.dataset.viewerState = state;
    status.textContent = state === 'loading' ? '图片加载中…' : state === 'error' ? '图片加载失败' : '';
  }

  function preloadAdjacentImages(): void {
    for (const index of [currentIndex - 1, currentIndex + 1]) {
      const item = items[index];
      if (!item) continue;
      const preload = new Image();
      preload.decoding = 'async';
      preload.src = item.source;
    }
  }

  function showImage(index: number): void {
    const item = items[index];
    if (!item || !dialog.open || disposed) return;

    cancelLoad();
    stopPointerInteraction();
    pendingWheelLog = 0;
    resetTransientInteractionState();
    currentIndex = index;
    const token = requestTracker.begin(index);
    resetTransform();
    updateNavigation();
    caption.textContent = item.caption;
    dialog.classList.toggle('sc-viewer-has-caption', Boolean(item.caption));
    original.href = item.source;
    image.alt = item.alt;
    setLoadState('loading');
    image.removeAttribute('src');

    let settled = false;
    const finish = async (loaded: boolean): Promise<void> => {
      if (settled) return;
      settled = true;
      cancelLoad();

      if (loaded) {
        try {
          await image.decode();
        } catch {
          loaded = image.complete && image.naturalWidth > 0;
        }
      }

      if (!requestTracker.isCurrent(token, currentIndex) || !dialog.open || disposed) return;
      if (!loaded || image.naturalWidth <= 0) {
        setLoadState('error');
        return;
      }

      refreshGeometry();
      resetTransform();
      setLoadState('ready');
      preloadAdjacentImages();
    };

    const onLoad = () => { void finish(true); };
    const onError = () => { void finish(false); };
    image.addEventListener('load', onLoad);
    image.addEventListener('error', onError);
    loadCleanup = () => {
      image.removeEventListener('load', onLoad);
      image.removeEventListener('error', onError);
    };
    loadTimer = window.setTimeout(() => { void finish(false); }, LOAD_TIMEOUT);
    image.src = item.source;

    if (image.complete) queueMicrotask(() => { void finish(image.naturalWidth > 0); });
  }

  function navigate(delta: number): void {
    const target = clampArticleImageViewerValue(currentIndex + delta, 0, items.length - 1);
    if (target !== currentIndex) showImage(target);
  }

  function lockPageScroll(): void {
    if (scrollLock) return;
    const body = document.body;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const computedPadding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    scrollLock = { x: window.scrollX, y: window.scrollY, properties: new Map() };

    setLockedStyle(body, scrollLock, 'position', 'fixed');
    setLockedStyle(body, scrollLock, 'top', `${-scrollLock.y}px`);
    setLockedStyle(body, scrollLock, 'left', `${-scrollLock.x}px`);
    setLockedStyle(body, scrollLock, 'right', '0px');
    setLockedStyle(body, scrollLock, 'width', '100%');
    setLockedStyle(body, scrollLock, 'overflow', 'hidden');
    if (scrollbarWidth > 0) setLockedStyle(body, scrollLock, 'padding-right', `${computedPadding + scrollbarWidth}px`);
  }

  function restorePageScroll(): void {
    if (!scrollLock) return;
    const saved = scrollLock;
    scrollLock = null;
    const body = document.body;

    for (const property of BODY_LOCK_PROPERTIES) {
      const snapshot = saved.properties.get(property);
      if (!snapshot || body.style.getPropertyValue(property) !== snapshot.appliedValue) continue;
      if (snapshot.value) body.style.setProperty(property, snapshot.value, snapshot.priority);
      else body.style.removeProperty(property);
    }
    window.scrollTo(saved.x, saved.y);
  }

  function cancelFrames(): void {
    if (renderFrame) window.cancelAnimationFrame(renderFrame);
    if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
    if (wheelFrame) window.cancelAnimationFrame(wheelFrame);
    renderFrame = 0;
    resizeFrame = 0;
    wheelFrame = 0;
    pendingWheelLog = 0;
  }

  function clearViewerRuntimeState(restoreFocus: boolean): void {
    if (dialog.open) dialog.close();
    cancelFrames();
    cancelLoad();
    hideHint();
    requestTracker.invalidate();
    stopPointerInteraction();
    resetTransientInteractionState();
    transform = resetArticleImageViewerTransform();
    image.style.removeProperty('transform');
    image.removeAttribute('src');
    image.alt = '';
    image.style.removeProperty('will-change');
    dialog.classList.remove('sc-viewer-is-zoomed');
    dialog.removeAttribute('data-viewer-state');
    original.removeAttribute('href');
    caption.textContent = '';
    dialog.classList.remove('sc-viewer-has-caption');
    status.textContent = '';
    currentIndex = -1;
    restorePageScroll();

    const trigger = opener;
    opener = null;
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  function openViewer(index: number): void {
    const item = items[index];
    if (!item || dialog.open || disposed) return;
    resetTransientInteractionState();
    opener = item.element;
    requestTracker.activate();

    try {
      dialog.showModal();
    } catch {
      requestTracker.invalidate();
      opener = null;
      return;
    }

    lockPageScroll();
    refreshGeometry();
    showImage(index);
    close.focus({ preventScroll: true });
    showHintOnce();
  }

  function closeViewer(): void {
    resetTransientInteractionState();
    requestTracker.invalidate();
    stopPointerInteraction();
    if (dialog.open) dialog.close();
  }

  function scheduleResize(): void {
    if (!dialog.open || resizeFrame) return;
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      if (!dialog.open) return;
      const previousGeometry = geometry;
      refreshGeometry();
      transform = resizeArticleImageViewerTransform(transform, previousGeometry, geometry);
      rebasePointerInteraction();
      scheduleRender();
    });
  }

  function processWheel(): void {
    wheelFrame = 0;
    if (!dialog.open || pendingWheelLog === 0) return;
    const change = clampArticleImageViewerValue(pendingWheelLog, -0.22, 0.22);
    pendingWheelLog -= change;
    const previousZoom = transform.zoom;
    updateTransform(zoomArticleImageViewerAtPoint(transform, transform.zoom * Math.exp(change), wheelPoint, geometry));

    if (
      (transform.zoom === ARTICLE_IMAGE_VIEWER_MIN_ZOOM && change < 0) ||
      (transform.zoom === ARTICLE_IMAGE_VIEWER_MAX_ZOOM && change > 0) ||
      transform.zoom === previousZoom
    ) pendingWheelLog = 0;

    if (Math.abs(pendingWheelLog) > 0.001) wheelFrame = window.requestAnimationFrame(processWheel);
  }

  items.forEach((item) => {
    const trigger = item.element;
    originalAttributes.set(trigger, captureArticleImageViewerAttributes(trigger));
    trigger.tabIndex = 0;
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-label', getArticleImageViewerAccessibleLabel(item.alt, item.caption));
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', dialog.id);
    trigger.dataset.imageViewerEnhanced = 'true';
  });

  article.addEventListener('click', (event) => {
    const trigger = event.target;
    if (
      !(trigger instanceof HTMLImageElement) ||
      event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    ) return;
    const index = items.findIndex((item) => item.element === trigger);
    if (index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    openViewer(index);
  }, { signal });

  article.addEventListener('keydown', (event) => {
    const trigger = event.target;
    if (!(trigger instanceof HTMLImageElement) || (event.key !== 'Enter' && event.key !== ' ')) return;
    const index = items.findIndex((item) => item.element === trigger);
    if (index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    openViewer(index);
  }, { signal });

  close.addEventListener('click', closeViewer, { signal });
  previous.addEventListener('click', () => navigate(-1), { signal });
  next.addEventListener('click', () => navigate(1), { signal });
  zoom.addEventListener('click', () => toggleZoomAt({
    x: stageRect.left + stageRect.width / 2,
    y: stageRect.top + stageRect.height / 2
  }), { signal });
  backdrop.addEventListener('click', (event) => {
    if (!isBackdropClickSuppressed(event)) closeViewer();
  }, { signal });
  image.addEventListener('dragstart', (event) => event.preventDefault(), { signal });

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeViewer();
  }, { signal });
  dialog.addEventListener('close', () => clearViewerRuntimeState(true), { signal });
  dialog.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeViewer();
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      updateTransform(zoomArticleImageViewerAtPoint(transform, transform.zoom + 0.5, { x: 0, y: 0 }, geometry));
    } else if (event.key === '-') {
      event.preventDefault();
      updateTransform(zoomArticleImageViewerAtPoint(transform, transform.zoom - 0.5, { x: 0, y: 0 }, geometry));
    } else if (event.key === '0' || event.key === '1') {
      event.preventDefault();
      resetTransform();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      navigate(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      navigate(1);
    }
  }, { signal });

  stage.addEventListener('wheel', (event) => {
    if (!dialog.open) return;
    event.preventDefault();
    hideHint();
    lastTap = null;
    const delta = normalizeArticleImageViewerWheelDelta(event.deltaY, event.deltaMode, stageRect.height);
    const sensitivity = event.ctrlKey ? 0.006 : 0.0015;
    pendingWheelLog += clampArticleImageViewerValue(-delta * sensitivity, -0.28, 0.28);
    wheelPoint = pointInStage({ x: event.clientX, y: event.clientY });
    if (!wheelFrame) wheelFrame = window.requestAnimationFrame(processWheel);
  }, { passive: false, signal });

  stage.addEventListener('dblclick', (event) => {
    if (performance.now() < ignoreNativeDoubleClickUntil) return;
    event.preventDefault();
    markClickSuppressed({ x: event.clientX, y: event.clientY });
    toggleZoomAt({ x: event.clientX, y: event.clientY });
  }, { signal });

  stage.addEventListener('pointerdown', (event) => {
    if ((event.pointerType === 'mouse' && event.button !== 0) || activePointers.has(event.pointerId)) return;
    hideHint();
    const point = { x: event.clientX, y: event.clientY };
    activePointers.set(event.pointerId, point);
    stage.setPointerCapture(event.pointerId);

    if (activePointers.size === 1) {
      singlePointerType = event.pointerType;
      startSinglePointer(event.pointerId, point);
    } else if (activePointers.size === 2) {
      startPinch();
    } else {
      gestureHadMultiplePointers = true;
      gestureMoved = true;
      markClickSuppressed(point);
    }
    event.preventDefault();
  }, { signal });

  stage.addEventListener('pointermove', (event) => {
    const previousPoint = activePointers.get(event.pointerId);
    if (!previousPoint) return;
    const point = { x: event.clientX, y: event.clientY };
    activePointers.set(event.pointerId, point);

    if (pinch && pinchPointerIds?.includes(event.pointerId)) {
      const first = activePointers.get(pinchPointerIds[0]);
      const second = activePointers.get(pinchPointerIds[1]);
      if (first && second) {
        updateTransform(updateArticleImageViewerPinch(
          pinch,
          pointInStage(first),
          pointInStage(second),
          geometry
        ));
      }
      event.preventDefault();
      return;
    }

    if (event.pointerId !== primaryPointerId || activePointers.size !== 1) return;
    const totalDistance = getArticleImageViewerDistance(singleStart, point);
    if (gestureMode === 'dragging' || totalDistance > GESTURE_MOVE_THRESHOLD) {
      gestureMoved = true;
      lastTap = null;
      markClickSuppressed(point);
      if (transform.zoom > ARTICLE_IMAGE_VIEWER_FIT_ZOOM) {
        gestureMode = 'dragging';
        stage.classList.add('sc-image-viewer-stage-dragging');
        updateTransform(panArticleImageViewerTransform(
          transform,
          point.x - previousPoint.x,
          point.y - previousPoint.y,
          geometry
        ));
      } else {
        gestureMode = 'swiping';
      }
    }
    event.preventDefault();
  }, { signal });

  stage.addEventListener('pointerup', (event) => finishPointer(event.pointerId, false), { signal });
  stage.addEventListener('pointercancel', (event) => finishPointer(event.pointerId, true), { signal });
  stage.addEventListener('lostpointercapture', (event) => {
    if (activePointers.has(event.pointerId)) finishPointer(event.pointerId, true);
  }, { signal });

  window.addEventListener('resize', scheduleResize, { signal });
  window.addEventListener('orientationchange', scheduleResize, { signal });
  window.visualViewport?.addEventListener('resize', scheduleResize, { signal });
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) {
      clearViewerRuntimeState(false);
      return;
    }
    teardown();
  }, { signal });

  function teardown(): void {
    if (disposed) return;
    disposed = true;
    controller.abort();
    if (dialog.open) dialog.close();
    clearViewerRuntimeState(false);
    for (const item of items) {
      const snapshot = originalAttributes.get(item.element);
      if (snapshot) restoreArticleImageViewerAttributes(item.element, snapshot);
      delete item.element.dataset.imageViewerEnhanced;
    }
    if (activeTeardown === teardown) activeTeardown = null;
  }

  activeTeardown = teardown;
  return teardown;
}
