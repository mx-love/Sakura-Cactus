import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  ARTICLE_IMAGE_VIEWER_FIT_ZOOM,
  ARTICLE_IMAGE_VIEWER_MAX_ZOOM,
  ARTICLE_IMAGE_VIEWER_MIN_ZOOM,
  beginArticleImageViewerPinch,
  constrainArticleImageViewerTransform,
  panArticleImageViewerTransform,
  updateArticleImageViewerPinch,
  resetArticleImageViewerTransform
} from '../src/lib/article-image-viewer.ts';

const viewerSource = readFileSync(new URL('../src/lib/article-image-viewer.ts', import.meta.url), 'utf8');
const viewerCss = readFileSync(new URL('../src/styles/article-image-viewer.css', import.meta.url), 'utf8');
const componentSource = readFileSync(
  new URL('../src/components/posts/ArticleImageViewer.astro', import.meta.url),
  'utf8'
);
const pageSource = readFileSync(new URL('../src/pages/posts/[slug].astro', import.meta.url), 'utf8');
const stylesDirectory = new URL('../src/styles/', import.meta.url);
const nonViewerCss = readdirSync(stylesDirectory)
  .filter((name) => name.endsWith('.css') && name !== 'article-image-viewer.css')
  .map((name) => readFileSync(new URL(name, stylesDirectory), 'utf8'))
  .join('\n');

function cssBlock(selector: string): string {
  const start = viewerCss.indexOf(selector);
  assert.notEqual(start, -1, `Missing CSS selector: ${selector}`);
  const open = viewerCss.indexOf('{', start);
  const close = viewerCss.indexOf('}', open);
  assert.notEqual(open, -1);
  assert.notEqual(close, -1);
  return viewerCss.slice(open + 1, close);
}

function testTransformRules(): void {
  assert.equal(ARTICLE_IMAGE_VIEWER_MIN_ZOOM, 0.5);
  assert.equal(ARTICLE_IMAGE_VIEWER_FIT_ZOOM, 1);
  assert.equal(ARTICLE_IMAGE_VIEWER_MAX_ZOOM, 4);

  const reset = resetArticleImageViewerTransform();
  assert.deepEqual(reset, { zoom: 1, panX: 0, panY: 0 });

  const bounds = { imageWidth: 600, imageHeight: 400, stageWidth: 800, stageHeight: 600 };
  assert.deepEqual(
    constrainArticleImageViewerTransform({ zoom: 0.5, panX: 80, panY: -60 }, bounds),
    { zoom: 0.5, panX: 0, panY: 0 }
  );
  assert.deepEqual(
    constrainArticleImageViewerTransform({ zoom: 0.1, panX: 80, panY: -60 }, bounds),
    { zoom: ARTICLE_IMAGE_VIEWER_MIN_ZOOM, panX: 0, panY: 0 }
  );
  assert.deepEqual(
    constrainArticleImageViewerTransform({ zoom: 0.75, panX: 80, panY: -60 }, bounds),
    { zoom: 0.75, panX: 0, panY: 0 }
  );
  assert.deepEqual(
    constrainArticleImageViewerTransform({ zoom: 2, panX: 999, panY: -999 }, bounds),
    { zoom: 2, panX: 200, panY: -100 }
  );
  assert.deepEqual(
    constrainArticleImageViewerTransform({ zoom: 99, panX: 9999, panY: -9999 }, bounds),
    { zoom: ARTICLE_IMAGE_VIEWER_MAX_ZOOM, panX: 800, panY: -500 }
  );
  assert.deepEqual(resetArticleImageViewerTransform(), reset);

  assert.deepEqual(
    panArticleImageViewerTransform({ zoom: 1, panX: 0, panY: 0 }, 40, -30, bounds),
    reset
  );
  assert.deepEqual(
    panArticleImageViewerTransform({ zoom: 2, panX: 0, panY: 0 }, 40, -30, bounds),
    { zoom: 2, panX: 40, panY: -30 }
  );
}

function testPinchRules(): void {
  const bounds = { imageWidth: 800, imageHeight: 600, stageWidth: 400, stageHeight: 300 };
  const initial = resetArticleImageViewerTransform();
  const zoomInPinch = beginArticleImageViewerPinch({ x: -50, y: 0 }, { x: 50, y: 0 }, initial);
  assert.ok(zoomInPinch);
  assert.deepEqual(
    updateArticleImageViewerPinch(zoomInPinch, { x: -100, y: 0 }, { x: 100, y: 0 }, bounds),
    { zoom: 2, panX: 0, panY: 0 }
  );

  const zoomOutPinch = beginArticleImageViewerPinch(
    { x: -100, y: 0 },
    { x: 100, y: 0 },
    { zoom: 2, panX: 80, panY: -40 }
  );
  assert.ok(zoomOutPinch);
  assert.deepEqual(
    updateArticleImageViewerPinch(zoomOutPinch, { x: -25, y: 0 }, { x: 25, y: 0 }, bounds),
    { zoom: 0.5, panX: 0, panY: 0 }
  );

  const belowFitPinch = beginArticleImageViewerPinch({ x: -50, y: 0 }, { x: 50, y: 0 }, initial);
  assert.ok(belowFitPinch);
  assert.deepEqual(
    updateArticleImageViewerPinch(belowFitPinch, { x: -17.5, y: 20 }, { x: 57.5, y: 20 }, bounds),
    { zoom: 0.75, panX: 0, panY: 0 }
  );

  const anchoredTransform = { zoom: 2, panX: 30, panY: -10 };
  const anchoredPinch = beginArticleImageViewerPinch({ x: -10, y: -20 }, { x: 90, y: 20 }, anchoredTransform);
  assert.ok(anchoredPinch);
  assert.deepEqual(
    updateArticleImageViewerPinch(anchoredPinch, { x: 0, y: -40 }, { x: 200, y: 40 }, bounds),
    { zoom: 4, panX: 80, panY: -20 }
  );

  const rebasedPinch = beginArticleImageViewerPinch(
    { x: 0, y: -40 },
    { x: 200, y: 40 },
    { zoom: 4, panX: 80, panY: -20 }
  );
  assert.ok(rebasedPinch);
  assert.deepEqual(
    updateArticleImageViewerPinch(rebasedPinch, { x: 0, y: -40 }, { x: 200, y: 40 }, bounds),
    { zoom: 4, panX: 80, panY: -20 }
  );
  assert.equal(beginArticleImageViewerPinch({ x: 1, y: 1 }, { x: 1, y: 1 }, initial), null);
}

function testPublicArticleMount(): void {
  assert.match(pageSource, /data-article-image-viewer-root=\{publicPost \? true : undefined\}/);
  assert.match(pageSource, /\{publicPost \? <ArticleImageViewer \/> : null\}/);
}

function testViewerMarkup(): void {
  const toolbar = componentSource.match(/<div class="sc-article-image-viewer-toolbar"[\s\S]*?<\/div>/)?.[0] ?? '';
  const operations = toolbar.match(/data-viewer-(?:zoom-out|fit|zoom-in|original)\b/g) ?? [];
  assert.equal(operations.length, 4);
  assert.match(componentSource, /data-viewer-original target="_blank" rel="noopener noreferrer"/);
  assert.match(componentSource, /data-viewer-close aria-label="关闭图片查看器"/);
  assert.doesNotMatch(componentSource, /data-viewer-(?:caption|count|previous|next)/);
  assert.doesNotMatch(componentSource, /图片说明|文件名|下载/);
}

function testLifecycleAndInteractionContracts(): void {
  for (const pattern of [
    /new AbortController\(\)/,
    /new Map<number, ArticleImageViewerPoint>\(\)/,
    /dialog\.showModal\(\)/,
    /event\.key !== 'Enter'/,
    /event\.key !== ' '/,
    /dialog\.addEventListener\('cancel'/,
    /dialog\.addEventListener\('close'/,
    /stage\.addEventListener\('pointercancel', \(event\) => removePointer\(event\.pointerId\)/,
    /image\.setPointerCapture\(event\.pointerId\)/,
    /activePointers\.clear\(\)/,
    /rebasePointerInteraction\(\)/,
    /window\.visualViewport\?\.addEventListener\('resize'/,
    /window\.cancelAnimationFrame\(openFrame\)/,
    /window\.cancelAnimationFrame\(resizeFrame\)/
  ]) assert.match(viewerSource, pattern);

  assert.match(viewerSource, /zoomOut\.addEventListener\('click', \(\) => setZoom\(transform\.zoom - 0\.5\)/);
  assert.match(viewerSource, /zoomIn\.addEventListener\('click', \(\) => setZoom\(transform\.zoom \+ 0\.5\)/);
  assert.match(viewerSource, /function clearViewer[\s\S]*?clearPointerState\(\)[\s\S]*?resetTransform\(\)/);
  assert.match(viewerSource, /function openViewer[\s\S]*?clearPointerState\(\)[\s\S]*?resetTransform\(\)/);
  assert.match(viewerSource, /function closeViewer[\s\S]*?clearPointerState\(\)/);
  assert.doesNotMatch(viewerSource, /pushState|popstate|history\.|download=|\/api\//i);
}

function testLayoutContracts(): void {
  const dialog = cssBlock('.sc-article-image-viewer');
  const stage = cssBlock('.sc-article-image-viewer-stage');
  const image = cssBlock('.sc-article-image-viewer-image');
  const toolbar = cssBlock('.sc-article-image-viewer-toolbar');
  assert.match(dialog, /position:\s*fixed/);
  assert.match(dialog, /inset:\s*0/);
  assert.match(dialog, /width:\s*100vw/);
  assert.match(dialog, /height:\s*100dvh/);
  assert.match(dialog, /max-width:\s*none/);
  assert.match(dialog, /max-height:\s*none/);
  assert.match(dialog, /margin:\s*0/);
  assert.match(dialog, /padding:\s*0/);
  assert.match(dialog, /border:\s*0/);
  assert.match(dialog, /background:\s*rgb\(9 10 14 \/ 92%\)/);
  assert.match(stage, /position:\s*absolute/);
  assert.match(stage, /top:\s*calc\(env\(safe-area-inset-top, 0px\) \+ 56px\)/);
  assert.match(stage, /bottom:\s*calc\(env\(safe-area-inset-bottom, 0px\) \+ 84px\)/);
  assert.match(stage, /display:\s*grid/);
  assert.match(stage, /place-items:\s*center/);
  assert.match(stage, /overflow:\s*hidden/);
  assert.match(stage, /touch-action:\s*none/);
  assert.match(image, /width:\s*auto/);
  assert.match(image, /height:\s*auto/);
  assert.match(image, /max-width:\s*100%/);
  assert.match(image, /max-height:\s*100%/);
  assert.match(image, /object-fit:\s*contain/);
  assert.match(toolbar, /position:\s*absolute/);
  assert.match(toolbar, /left:\s*50%/);
  assert.match(toolbar, /bottom:\s*calc\(12px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  assert.match(toolbar, /transform:\s*translateX\(-50%\)/);
  assert.doesNotMatch(image, /object-fit:\s*cover|aspect-ratio|(?:^|;)\s*height:\s*\d/i);
  assert.doesNotMatch(viewerCss, /object-fit:\s*cover/i);
  assert.equal(viewerCss.match(/touch-action:\s*none/g)?.length, 1);
  assert.doesNotMatch(nonViewerCss, /touch-action:\s*none/);
}

testTransformRules();
testPinchRules();
testPublicArticleMount();
testViewerMarkup();
testLifecycleAndInteractionContracts();
testLayoutContracts();

console.log('Article image viewer checks passed.');
