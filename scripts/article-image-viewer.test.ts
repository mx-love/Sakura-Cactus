import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ARTICLE_IMAGE_VIEWER_MAX_ZOOM,
  constrainArticleImageViewerTransform,
  resetArticleImageViewerTransform
} from '../src/lib/article-image-viewer.ts';

const viewerSource = readFileSync(new URL('../src/lib/article-image-viewer.ts', import.meta.url), 'utf8');
const viewerCss = readFileSync(new URL('../src/styles/article-image-viewer.css', import.meta.url), 'utf8');
const componentSource = readFileSync(
  new URL('../src/components/posts/ArticleImageViewer.astro', import.meta.url),
  'utf8'
);
const pageSource = readFileSync(new URL('../src/pages/posts/[slug].astro', import.meta.url), 'utf8');

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
  const reset = resetArticleImageViewerTransform();
  assert.deepEqual(reset, { zoom: 1, panX: 0, panY: 0 });

  const bounds = { imageWidth: 600, imageHeight: 400, stageWidth: 800, stageHeight: 600 };
  assert.deepEqual(
    constrainArticleImageViewerTransform({ zoom: 0.5, panX: 80, panY: -60 }, bounds),
    reset
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
    /dialog\.showModal\(\)/,
    /event\.key !== 'Enter'/,
    /event\.key !== ' '/,
    /dialog\.addEventListener\('cancel'/,
    /dialog\.addEventListener\('close'/,
    /stage\.addEventListener\('pointercancel', \(event\) => endDrag\(event\)/,
    /image\.setPointerCapture\(event\.pointerId\)/,
    /window\.cancelAnimationFrame\(openFrame\)/,
    /window\.cancelAnimationFrame\(resizeFrame\)/
  ]) assert.match(viewerSource, pattern);

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
}

testTransformRules();
testPublicArticleMount();
testViewerMarkup();
testLifecycleAndInteractionContracts();
testLayoutContracts();

console.log('Article image viewer checks passed.');
