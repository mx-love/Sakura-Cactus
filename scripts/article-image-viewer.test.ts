import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ARTICLE_IMAGE_VIEWER_FIT_ZOOM,
  ARTICLE_IMAGE_VIEWER_MAX_ZOOM,
  ARTICLE_IMAGE_VIEWER_MIN_ZOOM,
  ARTICLE_IMAGE_VIEWER_SECONDARY_ZOOM,
  ArticleImageViewerRequestTracker,
  beginArticleImageViewerPinch,
  captureArticleImageViewerAttributes,
  constrainArticleImageViewerTransform,
  createArticleImageViewerGeometry,
  getArticleImageViewerAccessibleLabel,
  getArticleImageViewerNavigationState,
  getArticleImageViewerPanBounds,
  getArticleImageViewerRebasedGestureMode,
  getArticleImageViewerSwipeDirection,
  getArticleImageViewerTransformBounds,
  normalizeArticleImageViewerWheelDelta,
  panArticleImageViewerTransform,
  resetArticleImageViewerTransform,
  resetArticleImageViewerTransientInteractionState,
  resizeArticleImageViewerTransform,
  resolveArticleImageViewerCaption,
  resolveArticleImageViewerSource,
  restoreArticleImageViewerAttributes,
  shouldEnhanceArticleImageViewerCandidate,
  shouldSuppressArticleImageViewerClick,
  updateArticleImageViewerPinch,
  zoomArticleImageViewerAtPoint
} from '../src/lib/article-image-viewer.ts';

const viewerSource = readFileSync(new URL('../src/lib/article-image-viewer.ts', import.meta.url), 'utf8');
const viewerCss = readFileSync(new URL('../src/styles/article-image-viewer.css', import.meta.url), 'utf8');
const componentSource = readFileSync(new URL('../src/components/posts/ArticleImageViewer.astro', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../src/pages/posts/[slug].astro', import.meta.url), 'utf8');
const packageSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

let testCount = 0;

function test(name: string, run: () => void): void {
  try {
    run();
    testCount += 1;
  } catch (error) {
    throw new Error(`Article image viewer test failed: ${name}`, { cause: error });
  }
}

function closeTo(actual: number, expected: number, message?: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `${actual} should equal ${expected}`);
}

const wideBounds = { imageWidth: 800, imageHeight: 400, stageWidth: 800, stageHeight: 600 };
const gestureBounds = { imageWidth: 800, imageHeight: 600, stageWidth: 400, stageHeight: 300 };

function assertGeometryFits(
  naturalWidth: number,
  naturalHeight: number,
  stageWidth: number,
  stageHeight: number
): ReturnType<typeof createArticleImageViewerGeometry> {
  const geometry = createArticleImageViewerGeometry(naturalWidth, naturalHeight, stageWidth, stageHeight);
  assert.ok(geometry.baseWidth <= stageWidth);
  assert.ok(geometry.baseHeight <= stageHeight);
  closeTo(geometry.baseWidth / geometry.baseHeight, naturalWidth / naturalHeight);
  assert.deepEqual(
    getArticleImageViewerPanBounds(1, getArticleImageViewerTransformBounds(geometry)),
    { maximumX: 0, maximumY: 0 }
  );
  return geometry;
}

test('uses the fit, secondary, and continuous zoom model', () => {
  assert.equal(ARTICLE_IMAGE_VIEWER_FIT_ZOOM, 1);
  assert.equal(ARTICLE_IMAGE_VIEWER_MIN_ZOOM, 1);
  assert.equal(ARTICLE_IMAGE_VIEWER_SECONDARY_ZOOM, 2.5);
  assert.equal(ARTICLE_IMAGE_VIEWER_MAX_ZOOM, 4);
});

test('resets to a fit transform', () => {
  assert.deepEqual(resetArticleImageViewerTransform(), { zoom: 1, panX: 0, panY: 0 });
});

test('fits a portrait image completely at logical 1x', () => {
  const geometry = assertGeometryFits(1080, 1920, 1600, 700);
  closeTo(geometry.baseWidth, 393.75);
  closeTo(geometry.baseHeight, 700);
});

test('fits the reported 1297 by 1729 portrait without changing its ratio', () => {
  const geometry = assertGeometryFits(1297, 1729, 1600, 700);
  closeTo(geometry.baseWidth, 1297 * 700 / 1729);
  closeTo(geometry.baseHeight, 700);
});

test('fits a landscape image completely at logical 1x', () => {
  const geometry = assertGeometryFits(1920, 1080, 1000, 700);
  closeTo(geometry.baseWidth, 1000);
  closeTo(geometry.baseHeight, 562.5);
});

test('fits an ultra-tall image and reaches its top and bottom after zoom', () => {
  const geometry = assertGeometryFits(800, 4000, 1600, 700);
  const bounds = getArticleImageViewerTransformBounds(geometry);
  const panBounds = getArticleImageViewerPanBounds(2.5, bounds);
  assert.deepEqual(panBounds, { maximumX: 0, maximumY: 525 });
  closeTo(panBounds.maximumY - geometry.baseHeight * 2.5 / 2, -geometry.stageHeight / 2);
  closeTo(-panBounds.maximumY + geometry.baseHeight * 2.5 / 2, geometry.stageHeight / 2);
});

test('fits an ultra-wide image and reaches its left and right edges after zoom', () => {
  const geometry = assertGeometryFits(4000, 800, 1000, 700);
  const bounds = getArticleImageViewerTransformBounds(geometry);
  const panBounds = getArticleImageViewerPanBounds(2.5, bounds);
  assert.deepEqual(panBounds, { maximumX: 750, maximumY: 0 });
  closeTo(panBounds.maximumX - geometry.baseWidth * 2.5 / 2, -geometry.stageWidth / 2);
  closeTo(-panBounds.maximumX + geometry.baseWidth * 2.5 / 2, geometry.stageWidth / 2);
});

test('does not automatically enlarge a small image at logical 1x', () => {
  const geometry = assertGeometryFits(320, 240, 1400, 800);
  assert.equal(geometry.baseWidth, 320);
  assert.equal(geometry.baseHeight, 240);
});

test('allows all four edges and corners at 2.5x without overscrolling', () => {
  const geometry = assertGeometryFits(1080, 1920, 600, 700);
  const bounds = getArticleImageViewerTransformBounds(geometry);
  const scaledWidth = geometry.baseWidth * 2.5;
  const scaledHeight = geometry.baseHeight * 2.5;
  const panBounds = getArticleImageViewerPanBounds(2.5, bounds);
  closeTo(panBounds.maximumX, (scaledWidth - geometry.stageWidth) / 2);
  closeTo(panBounds.maximumY, (scaledHeight - geometry.stageHeight) / 2);
  closeTo(panBounds.maximumX - scaledWidth / 2, -geometry.stageWidth / 2);
  closeTo(-panBounds.maximumX + scaledWidth / 2, geometry.stageWidth / 2);
  closeTo(panBounds.maximumY - scaledHeight / 2, -geometry.stageHeight / 2);
  closeTo(-panBounds.maximumY + scaledHeight / 2, geometry.stageHeight / 2);
  assert.deepEqual(
    constrainArticleImageViewerTransform({ zoom: 2.5, panX: 1e6, panY: -1e6 }, bounds),
    { zoom: 2.5, panX: panBounds.maximumX, panY: -panBounds.maximumY }
  );
});

test('creates fresh base dimensions when switching between aspect ratios', () => {
  const landscape = createArticleImageViewerGeometry(1920, 1080, 1000, 700);
  const portrait = createArticleImageViewerGeometry(1080, 1920, 1000, 700);
  assert.deepEqual([landscape.baseWidth, landscape.baseHeight], [1000, 562.5]);
  assert.deepEqual([portrait.baseWidth, portrait.baseHeight], [393.75, 700]);
  const landscapeAgain = createArticleImageViewerGeometry(1920, 1080, 1000, 700);
  assert.deepEqual(landscapeAgain, landscape);
});

test('recomputes fitted dimensions and pan bounds across desktop and mobile resize', () => {
  const desktop = createArticleImageViewerGeometry(1297, 1729, 1600, 700);
  const portraitPhone = createArticleImageViewerGeometry(1297, 1729, 304, 650);
  const landscapePhone = createArticleImageViewerGeometry(1297, 1729, 700, 240);
  closeTo(desktop.baseHeight, 700);
  closeTo(portraitPhone.baseWidth, 304);
  closeTo(landscapePhone.baseHeight, 240);
  for (const geometry of [desktop, portraitPhone, landscapePhone]) {
    assert.deepEqual(
      getArticleImageViewerPanBounds(1, getArticleImageViewerTransformBounds(geometry)),
      { maximumX: 0, maximumY: 0 }
    );
  }
});

test('zooms from fit at the stage center', () => {
  assert.deepEqual(
    zoomArticleImageViewerAtPoint(resetArticleImageViewerTransform(), 2, { x: 0, y: 0 }, wideBounds),
    { zoom: 2, panX: 0, panY: 0 }
  );
});

test('keeps a non-center content anchor under the pointer', () => {
  const point = { x: 100, y: 50 };
  const result = zoomArticleImageViewerAtPoint(resetArticleImageViewerTransform(), 2, point, wideBounds);
  assert.deepEqual(result, { zoom: 2, panX: -100, panY: -50 });
  closeTo((point.x - result.panX) / result.zoom, point.x);
  closeTo((point.y - result.panY) / result.zoom, point.y);
});

test('clamps continued zoom-in at 4x without changing pan', () => {
  const atMaximum = { zoom: 4, panX: 120, panY: -80 };
  assert.deepEqual(zoomArticleImageViewerAtPoint(atMaximum, 8, { x: 100, y: 50 }, wideBounds), atMaximum);
});

test('clamps continued zoom-out at fit without changing pan', () => {
  assert.deepEqual(
    zoomArticleImageViewerAtPoint({ zoom: 1, panX: 90, panY: -70 }, 0.5, { x: 100, y: 50 }, wideBounds),
    resetArticleImageViewerTransform()
  );
});

test('automatically clears pan when returning to fit', () => {
  assert.deepEqual(
    constrainArticleImageViewerTransform({ zoom: 1, panX: 200, panY: -150 }, wideBounds),
    resetArticleImageViewerTransform()
  );
});

test('keeps pan zero on a direction smaller than the stage', () => {
  assert.deepEqual(
    constrainArticleImageViewerTransform(
      { zoom: 1.5, panX: 100, panY: 100 },
      { imageWidth: 400, imageHeight: 600, stageWidth: 800, stageHeight: 600 }
    ),
    { zoom: 1.5, panX: 0, panY: 100 }
  );
});

test('calculates the horizontal boundary for an ultra-wide image', () => {
  assert.deepEqual(
    getArticleImageViewerPanBounds(2, { imageWidth: 800, imageHeight: 300, stageWidth: 800, stageHeight: 600 }),
    { maximumX: 400, maximumY: 0 }
  );
});

test('calculates the vertical boundary for an ultra-tall image', () => {
  assert.deepEqual(
    getArticleImageViewerPanBounds(2, { imageWidth: 300, imageHeight: 600, stageWidth: 800, stageHeight: 600 }),
    { maximumX: 0, maximumY: 300 }
  );
});

test('reconstrains pan after a viewport resize', () => {
  assert.deepEqual(
    constrainArticleImageViewerTransform(
      { zoom: 2, panX: 450, panY: 180 },
      { imageWidth: 800, imageHeight: 400, stageWidth: 1200, stageHeight: 800 }
    ),
    { zoom: 2, panX: 200, panY: 0 }
  );
});

test('preserves the viewed content position across fitted-image resize', () => {
  assert.deepEqual(resizeArticleImageViewerTransform(
    { zoom: 2, panX: 100, panY: -50 },
    { imageWidth: 800, imageHeight: 400, stageWidth: 800, stageHeight: 600 },
    { imageWidth: 400, imageHeight: 600, stageWidth: 400, stageHeight: 700 }
  ), { zoom: 2, panX: 50, panY: -75 });
});

test('pans only while zoomed and respects boundaries', () => {
  assert.deepEqual(
    panArticleImageViewerTransform({ zoom: 1, panX: 0, panY: 0 }, 100, 100, wideBounds),
    resetArticleImageViewerTransform()
  );
  assert.deepEqual(
    panArticleImageViewerTransform({ zoom: 2, panX: 390, panY: 90 }, 40, 40, wideBounds),
    { zoom: 2, panX: 400, panY: 100 }
  );
});

test('doubles zoom when pinch distance doubles', () => {
  const pinch = beginArticleImageViewerPinch({ x: -50, y: 0 }, { x: 50, y: 0 }, { zoom: 1, panX: 0, panY: 0 });
  assert.ok(pinch);
  assert.deepEqual(
    updateArticleImageViewerPinch(pinch, { x: -100, y: 0 }, { x: 100, y: 0 }, gestureBounds),
    { zoom: 2, panX: 0, panY: 0 }
  );
});

test('halves zoom when pinch distance halves', () => {
  const pinch = beginArticleImageViewerPinch({ x: -100, y: 0 }, { x: 100, y: 0 }, { zoom: 2, panX: 40, panY: 20 });
  assert.ok(pinch);
  assert.deepEqual(
    updateArticleImageViewerPinch(pinch, { x: -50, y: 0 }, { x: 50, y: 0 }, gestureBounds),
    resetArticleImageViewerTransform()
  );
});

test('moves the image with a moving pinch center', () => {
  const pinch = beginArticleImageViewerPinch({ x: -50, y: 0 }, { x: 50, y: 0 }, { zoom: 2, panX: 0, panY: 0 });
  assert.ok(pinch);
  assert.deepEqual(
    updateArticleImageViewerPinch(pinch, { x: 0, y: 30 }, { x: 100, y: 30 }, gestureBounds),
    { zoom: 2, panX: 50, panY: 30 }
  );
});

test('preserves the content anchor beneath a pinch center', () => {
  const pinch = beginArticleImageViewerPinch({ x: 0, y: 0 }, { x: 100, y: 0 }, { zoom: 1, panX: 0, panY: 0 });
  assert.ok(pinch);
  const result = updateArticleImageViewerPinch(pinch, { x: 0, y: 0 }, { x: 200, y: 0 }, gestureBounds);
  assert.deepEqual(result, { zoom: 2, panX: 0, panY: 0 });
  closeTo((100 - result.panX) / result.zoom, 50);
});

test('rebases one pointer into a pinch without changing the current transform', () => {
  const transform = { zoom: 2.5, panX: 50, panY: -30 };
  const pinch = beginArticleImageViewerPinch({ x: -40, y: -10 }, { x: 60, y: 10 }, transform);
  assert.ok(pinch);
  assert.deepEqual(updateArticleImageViewerPinch(pinch, { x: -40, y: -10 }, { x: 60, y: 10 }, gestureBounds), transform);
  assert.equal(getArticleImageViewerRebasedGestureMode(2, transform.zoom), 'pinching');
});

test('rebases two pointers into a continuing drag', () => {
  assert.equal(getArticleImageViewerRebasedGestureMode(1, 2), 'dragging');
  assert.equal(getArticleImageViewerRebasedGestureMode(1, 1), 'pressing');
  assert.equal(getArticleImageViewerRebasedGestureMode(0, 2), 'idle');
});

test('keeps pinch stable at maximum zoom', () => {
  const pinch = beginArticleImageViewerPinch({ x: -50, y: 0 }, { x: 50, y: 0 }, { zoom: 1, panX: 0, panY: 0 });
  assert.ok(pinch);
  assert.deepEqual(
    updateArticleImageViewerPinch(pinch, { x: -300, y: 0 }, { x: 300, y: 0 }, gestureBounds),
    { zoom: 4, panX: 0, panY: 0 }
  );
});

test('keeps pinch stable at minimum zoom', () => {
  const pinch = beginArticleImageViewerPinch({ x: -100, y: 0 }, { x: 100, y: 0 }, { zoom: 2, panX: 90, panY: 60 });
  assert.ok(pinch);
  assert.deepEqual(
    updateArticleImageViewerPinch(pinch, { x: -10, y: 20 }, { x: 10, y: 20 }, gestureBounds),
    resetArticleImageViewerTransform()
  );
});

test('rejects a zero-distance pinch', () => {
  assert.equal(
    beginArticleImageViewerPinch({ x: 10, y: 10 }, { x: 10, y: 10 }, resetArticleImageViewerTransform()),
    null
  );
});

test('normalizes pixel, line, and page wheel deltas', () => {
  assert.equal(normalizeArticleImageViewerWheelDelta(10, 0, 600), 10);
  assert.equal(normalizeArticleImageViewerWheelDelta(10, 1, 600), 160);
  assert.equal(normalizeArticleImageViewerWheelDelta(2, 2, 600), 1200);
});

test('does not classify a small tap as a drag click', () => {
  assert.equal(shouldSuppressArticleImageViewerClick(false, false, false, 'pressing'), false);
});

test('suppresses click after movement, pinch, swipe, or cancellation', () => {
  assert.equal(shouldSuppressArticleImageViewerClick(true, false, false, 'pressing'), true);
  assert.equal(shouldSuppressArticleImageViewerClick(false, true, false, 'pressing'), true);
  assert.equal(shouldSuppressArticleImageViewerClick(false, false, true, 'pressing'), true);
  assert.equal(shouldSuppressArticleImageViewerClick(false, false, false, 'dragging'), true);
  assert.equal(shouldSuppressArticleImageViewerClick(false, false, false, 'pinching'), true);
  assert.equal(shouldSuppressArticleImageViewerClick(false, false, false, 'swiping'), true);
});

test('resets all per-image click, double-tap, and swipe candidates', () => {
  const reset = resetArticleImageViewerTransientInteractionState();
  assert.deepEqual(reset, {
    ignoreNativeDoubleClickUntil: 0,
    suppressClickUntil: 0,
    suppressClickPoint: null,
    lastTap: null,
    singleStart: { x: 0, y: 0 },
    singlePointerType: '',
    gestureMode: 'idle',
    gestureMoved: false,
    gestureHadMultiplePointers: false
  });
  assert.deepEqual(resetArticleImageViewerTransientInteractionState(), reset);
});

test('allows a horizontal swipe only while fitted', () => {
  assert.equal(getArticleImageViewerSwipeDirection(-70, 10, 1, false), 1);
  assert.equal(getArticleImageViewerSwipeDirection(70, 10, 1, false), -1);
  assert.equal(getArticleImageViewerSwipeDirection(-70, 10, 2, false), 0);
  assert.equal(getArticleImageViewerSwipeDirection(-70, 10, 1, true), 0);
  assert.equal(getArticleImageViewerSwipeDirection(-40, 5, 1, false), 0);
  assert.equal(getArticleImageViewerSwipeDirection(-70, 65, 1, false), 0);
});

test('reports disabled and hidden multi-image navigation correctly', () => {
  assert.deepEqual(getArticleImageViewerNavigationState(0, 1), {
    hidden: true, previousDisabled: true, nextDisabled: true
  });
  assert.deepEqual(getArticleImageViewerNavigationState(0, 3), {
    hidden: false, previousDisabled: true, nextDisabled: false
  });
  assert.deepEqual(getArticleImageViewerNavigationState(2, 3), {
    hidden: false, previousDisabled: false, nextDisabled: true
  });
});

const baseUrl = 'https://blog.example/posts/demo';

test('prefers data-full-src over every other source', () => {
  assert.equal(resolveArticleImageViewerSource({
    dataFullSource: '/full/image.webp?width=2000',
    linkHref: '/linked/image.jpg',
    currentSource: '/responsive/image.avif',
    source: '/fallback/image.png'
  }, baseUrl), 'https://blog.example/full/image.webp?width=2000');
});

test('uses an outer link only when it is an image resource', () => {
  assert.equal(resolveArticleImageViewerSource({
    linkHref: 'https://cdn.example/photo.JPG?download=1',
    currentSource: '/thumb.jpg'
  }, baseUrl), 'https://cdn.example/photo.JPG?download=1');
  assert.equal(resolveArticleImageViewerSource({
    linkHref: 'https://shop.example/product/42',
    currentSource: '/thumb.jpg'
  }, baseUrl), 'https://blog.example/thumb.jpg');
});

test('recognizes the internal image proxy without an extension', () => {
  assert.equal(resolveArticleImageViewerSource({
    linkHref: '/i/01JIMAGEASSET?width=2400',
    source: '/thumb.jpg'
  }, baseUrl), 'https://blog.example/i/01JIMAGEASSET?width=2400');
});

test('allows a link explicitly marked as an original image', () => {
  assert.equal(resolveArticleImageViewerSource({
    linkHref: 'https://images.example/original?id=42',
    linkIsExplicit: true,
    source: '/thumb.jpg'
  }, baseUrl), 'https://images.example/original?id=42');
});

test('prefers currentSrc over src for picture and srcset output', () => {
  assert.equal(resolveArticleImageViewerSource({
    currentSource: 'https://cdn.example/selected.avif',
    source: 'https://cdn.example/fallback.jpg'
  }, baseUrl), 'https://cdn.example/selected.avif');
});

test('accepts supported image formats with query parameters', () => {
  for (const extension of ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg']) {
    assert.equal(resolveArticleImageViewerSource({
      linkHref: `https://cdn.example/image.${extension}?v=2`,
      source: '/fallback.png'
    }, baseUrl), `https://cdn.example/image.${extension}?v=2`);
  }
});

const selectableCandidate = {
  excluded: false,
  hidden: false,
  presentational: false,
  decorative: false,
  insideInteractiveControl: false,
  semanticUiImage: false,
  trackingPixel: false,
  explicit: false,
  linkedToNonImage: false,
  hasSource: true
};

test('honors data-no-image-viewer and semantic exclusions', () => {
  assert.equal(shouldEnhanceArticleImageViewerCandidate({ ...selectableCandidate, excluded: true, explicit: true }), false);
  assert.equal(shouldEnhanceArticleImageViewerCandidate({ ...selectableCandidate, hidden: true }), false);
  assert.equal(shouldEnhanceArticleImageViewerCandidate({ ...selectableCandidate, presentational: true }), false);
  assert.equal(shouldEnhanceArticleImageViewerCandidate({ ...selectableCandidate, decorative: true }), false);
  assert.equal(shouldEnhanceArticleImageViewerCandidate({ ...selectableCandidate, semanticUiImage: true }), false);
  assert.equal(shouldEnhanceArticleImageViewerCandidate({ ...selectableCandidate, trackingPixel: true }), false);
});

test('preserves ordinary webpage links unless explicitly enabled', () => {
  assert.equal(shouldEnhanceArticleImageViewerCandidate({ ...selectableCandidate, linkedToNonImage: true }), false);
  assert.equal(shouldEnhanceArticleImageViewerCandidate({
    ...selectableCandidate, linkedToNonImage: true, explicit: true
  }), true);
});

test('does not reject a small content image solely for its natural size', () => {
  assert.equal(shouldEnhanceArticleImageViewerCandidate(selectableCandidate), true);
});

test('resolves captions in the documented priority order', () => {
  assert.equal(resolveArticleImageViewerCaption({
    figureCaption: 'Figure caption', adjacentCaption: 'Adjacent caption', title: 'Title', alt: 'Alt'
  }), 'Figure caption');
  assert.equal(resolveArticleImageViewerCaption({
    adjacentCaption: 'Adjacent caption', title: 'Title', alt: 'Alt'
  }), 'Adjacent caption');
  assert.equal(resolveArticleImageViewerCaption({ title: 'Title', alt: 'Alt' }), 'Title');
  assert.equal(resolveArticleImageViewerCaption({ alt: 'Alt' }), 'Alt');
  assert.equal(resolveArticleImageViewerCaption({}), '');
});

class FakeAttributeHost {
  readonly attributes = new Map<string, string>();
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  removeAttribute(name: string): void { this.attributes.delete(name); }
}

test('restores existing accessibility attributes exactly', () => {
  const element = new FakeAttributeHost();
  element.setAttribute('tabindex', '3');
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', 'Original label');
  const snapshot = captureArticleImageViewerAttributes(element);
  element.setAttribute('tabindex', '0');
  element.setAttribute('role', 'button');
  element.setAttribute('aria-label', 'Viewer label');
  element.setAttribute('aria-haspopup', 'dialog');
  element.setAttribute('aria-controls', 'viewer');
  restoreArticleImageViewerAttributes(element, snapshot);
  assert.equal(element.getAttribute('tabindex'), '3');
  assert.equal(element.getAttribute('role'), 'img');
  assert.equal(element.getAttribute('aria-label'), 'Original label');
  assert.equal(element.getAttribute('aria-haspopup'), null);
  assert.equal(element.getAttribute('aria-controls'), null);
});

test('removes attributes that did not exist before enhancement', () => {
  const element = new FakeAttributeHost();
  const snapshot = captureArticleImageViewerAttributes(element);
  element.setAttribute('tabindex', '0');
  element.setAttribute('role', 'button');
  restoreArticleImageViewerAttributes(element, snapshot);
  assert.equal(element.attributes.size, 0);
});

test('includes image content in the enhanced accessible label', () => {
  assert.equal(getArticleImageViewerAccessibleLabel('站点架构图', ''), '查看大图：站点架构图');
  assert.equal(getArticleImageViewerAccessibleLabel('', '部署流程'), '查看大图：部署流程');
  assert.equal(getArticleImageViewerAccessibleLabel('', ''), '查看大图');
});

test('prevents stale and closed image requests from becoming current', () => {
  const tracker = new ArticleImageViewerRequestTracker();
  tracker.activate();
  const first = tracker.begin(0);
  const second = tracker.begin(1);
  assert.equal(tracker.isCurrent(first, 0), false);
  assert.equal(tracker.isCurrent(second, 1), true);
  tracker.invalidate();
  assert.equal(tracker.isCurrent(second, 1), false);
});

test('allows a later image request to recover after an earlier error', () => {
  const tracker = new ArticleImageViewerRequestTracker();
  const failed = tracker.begin(0);
  assert.equal(tracker.isCurrent(failed, 0), true);
  const recovered = tracker.begin(1);
  assert.equal(tracker.isCurrent(failed, 0), false);
  assert.equal(tracker.isCurrent(recovered, 1), true);
});

test('mounts the viewer only on public article pages', () => {
  assert.match(pageSource, /data-article-image-viewer-root/);
  assert.match(pageSource, /\{publicPost \? <ArticleImageViewer \/> : null\}/);
});

test('uses native dialog markup with an explicit backdrop and concise controls', () => {
  assert.match(componentSource, /<dialog[^>]+aria-label="文章图片查看器"/);
  for (const marker of [
    'data-viewer-backdrop', 'data-viewer-stage', 'data-viewer-close', 'data-viewer-prev',
    'data-viewer-next', 'data-viewer-count', 'data-viewer-zoom-out', 'data-viewer-fit',
    'data-viewer-zoom-in', 'data-viewer-original',
    'data-viewer-caption', 'data-viewer-status'
  ]) assert.match(componentSource, new RegExp(marker));
  assert.match(componentSource, /data-viewer-zoom-out aria-label="缩小图片" disabled/);
  assert.match(componentSource, /data-viewer-fit aria-label="恢复适合屏幕" disabled/);
  assert.match(componentSource, /data-viewer-zoom-in aria-label="放大图片" disabled/);
});

test('removes the mobile gesture hint and updates zoom button boundary states', () => {
  for (const source of [componentSource, viewerSource, viewerCss]) {
    assert.doesNotMatch(source, /双指缩放 · 双击放大|data-viewer-hint|viewer-hint|hintTimer|hintShown|showHintOnce|hideHint/);
  }
  assert.match(viewerSource, /zoomOut\.disabled = !ready \|\| transform\.zoom <= ARTICLE_IMAGE_VIEWER_MIN_ZOOM/);
  assert.match(viewerSource, /fit\.disabled = !ready \|\| !zoomed/);
  assert.match(viewerSource, /zoomIn\.disabled = !ready \|\| transform\.zoom >= ARTICLE_IMAGE_VIEWER_MAX_ZOOM/);
  assert.match(viewerCss, /@media \(max-width: 639px\), \(pointer: coarse\)[\s\S]*?\.sc-article-image-viewer-zoom-out,[\s\S]*?\.sc-article-image-viewer-zoom-in \{\s*display: none/);
  assert.match(viewerCss, /\.sc-article-image-viewer\.sc-viewer-is-zoomed \.sc-article-image-viewer-fit \{\s*display: inline-grid/);
});

test('keeps navigation feedback visible without sticky touch hover', () => {
  assert.match(viewerCss, /\.sc-article-image-viewer-nav\s*\{[\s\S]*?background:\s*rgb\(28 28 34 \/ 72%\)/);
  assert.match(viewerCss, /@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.sc-article-image-viewer-nav:not\(:disabled\):hover\s*\{\s*background:\s*rgb\(44 44 52 \/ 90%\)/);
  assert.doesNotMatch(viewerCss, /(?:^|\})\s*\.sc-article-image-viewer-nav:hover\s*\{/m);
  assert.doesNotMatch(viewerCss, /\.sc-article-image-viewer-(?:prev|next)(?::(?:hover|active|focus|focus-visible))?\s*\{[^}]*background:/);
  assert.match(viewerCss, /\.sc-article-image-viewer-nav:not\(:disabled\):active\s*\{\s*background:\s*rgb\(48 48 56 \/ 94%\);\s*\}/);
  assert.match(viewerCss, /\.sc-article-image-viewer-nav:focus-visible\s*\{[\s\S]*?outline:\s*3px solid/);
  assert.doesNotMatch(viewerCss, /\.sc-article-image-viewer-nav:focus(?!-visible)[^{]*\{[^}]*background:/);
  assert.match(viewerCss, /\.sc-article-image-viewer-nav:disabled,[\s\S]*?opacity:\s*0\.3/);
  assert.match(viewerCss, /@media \(max-width: 639px\), \(pointer: coarse\)[\s\S]*?\.sc-article-image-viewer-nav\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*48px/);
});

test('binds the complete pointer lifecycle and explicit close paths', () => {
  assert.match(viewerSource, /new Map<number, ArticleImageViewerPoint>\(\)/);
  for (const eventName of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
    assert.match(viewerSource, new RegExp(`stage\\.addEventListener\\('${eventName}'`));
  }
  assert.match(viewerSource, /backdrop\.addEventListener\('click'/);
  assert.doesNotMatch(viewerSource, /dialog\.addEventListener\('click'/);
  assert.doesNotMatch(viewerSource, /event\.target === (?:stage|shell)/);
});

test('coalesces pointer, wheel, and resize rendering and cleans lifecycle state', () => {
  assert.match(viewerSource, /window\.requestAnimationFrame\(renderTransform\)/);
  assert.match(viewerSource, /window\.requestAnimationFrame\(processWheel\)/);
  assert.match(viewerSource, /window\.visualViewport\?\.addEventListener\('resize'/);
  assert.match(viewerSource, /window\.addEventListener\('orientationchange'/);
  assert.match(viewerSource, /window\.cancelAnimationFrame\(renderFrame\)/);
  assert.match(viewerSource, /requestTracker\.invalidate\(\)/);
  assert.match(viewerSource, /restorePageScroll\(\)/);
  assert.doesNotMatch(viewerSource, /body\.getAttribute\('style'\)|body\.setAttribute\('style'/);
});

test('derives runtime fit geometry from natural dimensions instead of DOM offsets', () => {
  assert.doesNotMatch(viewerSource, /image\.(?:offsetWidth|offsetHeight|clientWidth|clientHeight)/);
  assert.match(viewerSource, /createArticleImageViewerGeometry\(\s*image\.naturalWidth,\s*image\.naturalHeight,\s*stageRect\.width,\s*stageRect\.height/);
  assert.match(viewerSource, /image\.style\.width = `\$\{geometry\.baseWidth\}px`/);
  assert.match(viewerSource, /image\.style\.height = `\$\{geometry\.baseHeight\}px`/);
  assert.match(viewerSource, /cancelFrames\(\);\s*cancelLoad\(\);[\s\S]*?activeRequest = token;[\s\S]*?clearImageGeometry\(\);[\s\S]*?setLoadState\('loading'\)/);
  assert.match(viewerSource, /if \(!requestTracker\.isCurrent\(token, currentIndex\) \|\| !dialog\.open \|\| disposed\) return/);
});

test('synchronously clears BFCache runtime state without permanent teardown', () => {
  assert.match(viewerSource, /function clearViewerRuntimeState[\s\S]*?cancelFrames\(\)[\s\S]*?cancelLoad\(\)[\s\S]*?requestTracker\.invalidate\(\)[\s\S]*?stopPointerInteraction\(\)[\s\S]*?resetTransientInteractionState\(\)[\s\S]*?clearImageGeometry\(true\)[\s\S]*?restorePageScroll\(\)/);
  assert.match(viewerSource, /window\.addEventListener\('pagehide', \(event\) => \{\s*if \(event\.persisted\) \{\s*clearViewerRuntimeState\(false\);\s*return;\s*\}\s*teardown\(\);/);
  assert.doesNotMatch(viewerSource, /window\.addEventListener\('pageshow'/);
});

test('keeps repeated runtime cleanup operations guarded and safe', () => {
  assert.match(viewerSource, /function clearViewerRuntimeState[\s\S]*?if \(dialog\.open\) dialog\.close\(\)/);
  assert.match(viewerSource, /function releasePointerCapture[\s\S]*?stage\.hasPointerCapture\(pointerId\)/);
  assert.match(viewerSource, /function restorePageScroll[\s\S]*?if \(!scrollLock\) return/);
  assert.match(viewerSource, /function cancelFrames[\s\S]*?if \(renderFrame\)[\s\S]*?if \(resizeFrame\)[\s\S]*?if \(wheelFrame\)/);
  assert.match(viewerSource, /function cancelLoad[\s\S]*?if \(loadTimer\)/);
});

test('keeps viewer touch behavior scoped and layout viewport-safe', () => {
  assert.match(viewerCss, /\.sc-article-image-viewer-stage\s*\{[\s\S]*?touch-action:\s*none/);
  assert.equal(viewerCss.match(/touch-action:\s*none/g)?.length, 1);
  assert.match(viewerCss, /height:\s*100dvh/);
  assert.doesNotMatch(viewerCss, /width:\s*100vw/);
  assert.match(viewerCss, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(viewerCss, /min-width:\s*44px/);
});

test('does not add a browser-test dependency implicitly', () => {
  const packageJson = JSON.parse(packageSource) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  assert.equal('playwright' in dependencies || '@playwright/test' in dependencies || 'cypress' in dependencies, false);
});

console.log(`Article image viewer checks passed (${testCount} behavior groups).`);
