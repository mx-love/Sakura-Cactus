import assert from 'node:assert/strict';
import { shareArticle } from '../src/lib/article-share.ts';
import { getReadingProgress } from '../src/lib/reading-progress.ts';

const title = '测试文章';
const url = 'https://example.com/posts/test';
let nativeShares = 0;
let copiedUrl = '';

assert.equal(await shareArticle(title, url, {
  async share(data) {
    nativeShares += 1;
    assert.deepEqual(data, { title, url });
  },
  clipboard: { async writeText(value) { copiedUrl = value; } }
}), 'shared');
assert.equal(nativeShares, 1);
assert.equal(copiedUrl, '');

assert.equal(await shareArticle(title, url, {
  async share() { throw new DOMException('Cancelled', 'AbortError'); },
  clipboard: { async writeText(value) { copiedUrl = value; } }
}), 'cancelled');
assert.equal(copiedUrl, '');

assert.equal(await shareArticle(title, url, {
  async share() { throw new TypeError('Sharing is not supported'); },
  clipboard: { async writeText(value) { copiedUrl = value; } }
}), 'copied');
assert.equal(copiedUrl, url);

assert.equal(await shareArticle(title, url, {
  clipboard: { async writeText(value) { copiedUrl = value; } }
}), 'copied');
await assert.rejects(() => shareArticle(title, url, {}), /Clipboard is unavailable/);
await assert.rejects(() => shareArticle(title, url, {
  clipboard: { async writeText() { throw new Error('Clipboard permission denied'); } }
}), /Clipboard permission denied/);

assert.equal(getReadingProgress(0, 1000, 2000, 800, 80), 0);
assert.equal(getReadingProgress(920, 1000, 2000, 800, 80), 0);
assert.equal(getReadingProgress(1560, 1000, 2000, 800, 80), 0.5);
assert.equal(getReadingProgress(2200, 1000, 2000, 800, 80), 1);
assert.equal(getReadingProgress(10000, 1000, 2000, 800, 80), 1);
assert.ok(getReadingProgress(2200, 1000, 3000, 800, 80) < 1);
assert.equal(getReadingProgress(0, 100, 200, 800, 80), 1);
assert.equal(getReadingProgress(0, 1000, 200, 800, 80), 0);
assert.equal(getReadingProgress(400, 1000, 200, 800, 80), 1);

console.log('Reading progress and article sharing regression tests passed.');
