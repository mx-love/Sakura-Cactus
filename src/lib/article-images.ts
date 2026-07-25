export const ARTICLE_IMAGE_MIN_SCALE = 1;
export const ARTICLE_IMAGE_MAX_SCALE = 4;

const ABSOLUTE_HTTP_URL_PATTERN = /^https?:\/\//i;
const INTERNAL_IMAGE_PATH_PATTERN = /^\/i\/[A-Za-z0-9_-]{24,64}$/;

export type ArticleImageKind = 'landscape' | 'square' | 'portrait' | 'long';

export type ArticleImageTransform = { scale: number; x: number; y: number };
export type ArticleImagePoint = { x: number; y: number };
export type ArticleImageSourceAction = { kind: 'download' | 'open'; href: string };
export type ArticleImageViewport = {
  baseWidth: number;
  baseHeight: number;
  viewportWidth: number;
  viewportHeight: number;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function classifyArticleImage(width: number, height: number): ArticleImageKind | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const ratio = width / height;

  if (ratio >= 1.2) return 'landscape';
  if (ratio >= 0.85) return 'square';
  if (ratio >= 0.58) return 'portrait';
  return 'long';
}

export function getArticleImageSourceAction(
  rawSource: string,
  pageUrl: string
): ArticleImageSourceAction | null {
  const source = rawSource.trim();

  if (!source.startsWith('/i/') && !ABSOLUTE_HTTP_URL_PATTERN.test(source)) {
    return null;
  }

  let sourceUrl: URL;
  let currentPageUrl: URL;

  try {
    sourceUrl = new URL(source, pageUrl);
    currentPageUrl = new URL(pageUrl);
  } catch {
    return null;
  }

  if (
    (sourceUrl.protocol !== 'http:' && sourceUrl.protocol !== 'https:') ||
    (currentPageUrl.protocol !== 'http:' && currentPageUrl.protocol !== 'https:')
  ) {
    return null;
  }

  if (sourceUrl.origin === currentPageUrl.origin && INTERNAL_IMAGE_PATH_PATTERN.test(sourceUrl.pathname)) {
    sourceUrl.searchParams.set('download', '1');
    sourceUrl.hash = '';

    return { kind: 'download', href: sourceUrl.href };
  }

  if (sourceUrl.origin === currentPageUrl.origin && sourceUrl.pathname.startsWith('/i/')) {
    return null;
  }

  return { kind: 'open', href: sourceUrl.href };
}

export function clampArticleImageTransform(
  transform: ArticleImageTransform,
  viewport: ArticleImageViewport
): ArticleImageTransform {
  const scale = clamp(
    finiteOrZero(transform.scale) || ARTICLE_IMAGE_MIN_SCALE,
    ARTICLE_IMAGE_MIN_SCALE,
    ARTICLE_IMAGE_MAX_SCALE
  );
  const baseWidth = Math.max(0, finiteOrZero(viewport.baseWidth));
  const baseHeight = Math.max(0, finiteOrZero(viewport.baseHeight));
  const viewportWidth = Math.max(0, finiteOrZero(viewport.viewportWidth));
  const viewportHeight = Math.max(0, finiteOrZero(viewport.viewportHeight));
  const maximumX = Math.max(0, (baseWidth * scale - viewportWidth) / 2);
  const maximumY = Math.max(0, (baseHeight * scale - viewportHeight) / 2);

  if (scale === ARTICLE_IMAGE_MIN_SCALE) {
    return { scale, x: 0, y: 0 };
  }

  return {
    scale,
    x: clamp(finiteOrZero(transform.x), -maximumX, maximumX),
    y: clamp(finiteOrZero(transform.y), -maximumY, maximumY)
  };
}

export function zoomArticleImageTransformAtPoint(
  transform: ArticleImageTransform,
  nextScale: number,
  point: ArticleImagePoint,
  viewport: ArticleImageViewport
): ArticleImageTransform {
  const current = clampArticleImageTransform(transform, viewport);
  const scale = clamp(
    finiteOrZero(nextScale) || ARTICLE_IMAGE_MIN_SCALE,
    ARTICLE_IMAGE_MIN_SCALE,
    ARTICLE_IMAGE_MAX_SCALE
  );

  if (scale === ARTICLE_IMAGE_MIN_SCALE) {
    return { scale, x: 0, y: 0 };
  }

  const ratio = scale / current.scale;
  const pointX = finiteOrZero(point.x);
  const pointY = finiteOrZero(point.y);

  return clampArticleImageTransform(
    {
      scale,
      x: pointX - (pointX - current.x) * ratio,
      y: pointY - (pointY - current.y) * ratio
    },
    viewport
  );
}
