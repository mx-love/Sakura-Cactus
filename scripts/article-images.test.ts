import assert from 'node:assert/strict';
import {
  clampArticleImageTransform,
  classifyArticleImage,
  getArticleImageSourceAction,
  zoomArticleImageTransformAtPoint
} from '../src/lib/article-images.ts';

function testImageClassification(): void {
  assert.equal(classifyArticleImage(1200, 1000), 'landscape');
  assert.equal(classifyArticleImage(1199, 1000), 'square');
  assert.equal(classifyArticleImage(850, 1000), 'square');
  assert.equal(classifyArticleImage(849, 1000), 'portrait');
  assert.equal(classifyArticleImage(580, 1000), 'portrait');
  assert.equal(classifyArticleImage(579, 1000), 'long');

  assert.equal(classifyArticleImage(1600, 900), 'landscape');
  assert.equal(classifyArticleImage(1000, 1000), 'square');
  assert.equal(classifyArticleImage(800, 1200), 'portrait');
  assert.equal(classifyArticleImage(500, 1200), 'long');

  for (const [width, height] of [
    [0, 100],
    [100, 0],
    [-1, 100],
    [100, -1],
    [Number.NaN, 100],
    [100, Number.NaN],
    [Number.POSITIVE_INFINITY, 100],
    [100, Number.POSITIVE_INFINITY]
  ]) {
    assert.equal(classifyArticleImage(width, height), null, `${width}x${height} should not be classified`);
  }
}

function testImageSourceActions(): void {
  const pageUrl = 'https://blog.example/posts/hello';
  const minimumToken = 'aB_9-'.repeat(5).slice(0, 24);
  const maximumToken = 'Z'.repeat(64);

  for (const rawSource of [
    `/i/${minimumToken}`,
    `https://blog.example/i/${maximumToken}`
  ]) {
    const action = getArticleImageSourceAction(rawSource, pageUrl);

    assert.ok(action);
    assert.equal(action.kind, 'download');
    assert.deepEqual(Object.keys(action).sort(), ['href', 'kind']);

    const downloadUrl = new URL(action.href, pageUrl);
    assert.equal(downloadUrl.origin, 'https://blog.example');
    assert.equal(downloadUrl.pathname, new URL(rawSource, pageUrl).pathname);
    assert.equal(downloadUrl.searchParams.get('download'), '1');
  }

  for (const rawSource of [
    'https://cdn.example/photo.jpg',
    'http://cdn.example/photo.jpg',
    'https://blog.example/images/local-photo.jpg',
    `https://cdn.example/i/${minimumToken}`
  ]) {
    const action = getArticleImageSourceAction(rawSource, pageUrl);

    assert.ok(action);
    assert.equal(action.kind, 'open');
    assert.deepEqual(Object.keys(action).sort(), ['href', 'kind']);
    assert.equal(new URL(action.href, pageUrl).protocol.startsWith('http'), true);
  }

  for (const rawSource of [
    '',
    '   ',
    '/images/local-photo.jpg',
    `https://blog.example/i/${'x'.repeat(23)}`,
    `/i/${'x'.repeat(23)}`,
    `/i/${'x'.repeat(65)}`,
    '//cdn.example/photo.jpg',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:image/svg+xml,<svg></svg>',
    'file:///etc/passwd',
    'blob:https://blog.example/asset',
    'mailto:test@example.com',
    'https://'
  ]) {
    assert.equal(getArticleImageSourceAction(rawSource, pageUrl), null, `${rawSource} should be rejected`);
  }
}

function testTransformClamping(): void {
  const viewport = {
    baseWidth: 600,
    baseHeight: 400,
    viewportWidth: 800,
    viewportHeight: 600
  };

  assert.deepEqual(
    clampArticleImageTransform({ scale: 0.25, x: 200, y: -200 }, viewport),
    { scale: 1, x: 0, y: 0 }
  );
  assert.deepEqual(
    clampArticleImageTransform({ scale: 1, x: 200, y: -200 }, viewport),
    { scale: 1, x: 0, y: 0 }
  );
  assert.deepEqual(
    clampArticleImageTransform({ scale: 2, x: 999, y: -999 }, viewport),
    { scale: 2, x: 200, y: -100 }
  );
  assert.deepEqual(
    clampArticleImageTransform({ scale: 2, x: 125, y: -75 }, viewport),
    { scale: 2, x: 125, y: -75 }
  );
  assert.deepEqual(
    clampArticleImageTransform({ scale: 9, x: 9999, y: -9999 }, viewport),
    { scale: 4, x: 800, y: -500 }
  );

  const zoomedAtPoint = zoomArticleImageTransformAtPoint(
    { scale: 1, x: 0, y: 0 },
    2,
    { x: 100, y: 50 },
    viewport
  );
  assert.deepEqual(zoomedAtPoint, { scale: 2, x: -100, y: -50 });
  assert.deepEqual(
    zoomArticleImageTransformAtPoint(zoomedAtPoint, 1, { x: 100, y: 50 }, viewport),
    { scale: 1, x: 0, y: 0 }
  );
  assert.deepEqual(
    zoomArticleImageTransformAtPoint(zoomedAtPoint, 99, { x: 0, y: 0 }, viewport),
    { scale: 4, x: -200, y: -100 }
  );
}

testImageClassification();
testImageSourceActions();
testTransformClamping();

console.log('Article image checks passed.');
