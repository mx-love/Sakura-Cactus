import assert from 'node:assert/strict';
import { assertValidImageBytes, assertValidImageFile, sanitizeOriginalFilename } from '../src/features/assets/asset.security.ts';
import { clearRateLimitWithDb, consumeRateLimitWithDb, getRateLimitWindow } from '../src/features/rate-limit/rate-limit.core.ts';
import { extractAssetTokens, extractFirstImageUrl, renderMarkdown, rewriteMarkdownAssetUrls } from '../src/features/posts/post.renderer.ts';
import {
  fetchPublicHttpStatusWithRedirects,
  normalizePublicHttpUrl,
  UnsafeExternalUrlError
} from '../src/lib/security/external-url.ts';
import {
  getClientAddress,
  isSameOriginBrowserRequest,
  isStrictSameOriginBrowserRequest,
  normalizeInternalRedirect
} from '../src/lib/security/request.ts';
import { resolveSiteOrigin, SiteUrlConfigurationError } from '../src/lib/site-url.ts';

type RateLimitRow = {
  scope: string;
  key_hash: string;
  window_start: string;
  count: number;
  expires_at: string;
  updated_at: string;
};

type FakeRateLimitDb = D1Database & {
  seed(rows: RateLimitRow[]): void;
  rows(): RateLimitRow[];
};

function expectUnsafeUrl(value: string, base?: string): void {
  assert.throws(() => normalizePublicHttpUrl(value, base), UnsafeExternalUrlError, value);
}

function makeImageFile(name: string, type: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function createFakeRateLimitDb(): FakeRateLimitDb {
  const rows = new Map<string, RateLimitRow>();
  const keyFor = (scope: string, keyHash: string, windowStart: string) => `${scope}\u0000${keyHash}\u0000${windowStart}`;
  const result = () => ({ success: true, meta: { changes: 1 } });

  return {
    seed(seedRows: RateLimitRow[]) {
      for (const row of seedRows) {
        rows.set(keyFor(row.scope, row.key_hash, row.window_start), { ...row });
      }
    },
    rows() {
      return [...rows.values()];
    },
    prepare(query: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...nextValues: unknown[]) {
          values = nextValues;
          return statement;
        },
        async run() {
          if (query.includes('WHERE rowid IN')) {
            const cutoff = String(values[0]);
            const expired = [...rows.entries()]
              .filter(([, row]) => row.expires_at <= cutoff)
              .slice(0, 100);

            for (const [key] of expired) {
              rows.delete(key);
            }

            return result();
          }

          if (query.includes('INSERT INTO rate_limits')) {
            const [scope, keyHash, windowStart, expiresAt, updatedAt] = values.map(String);
            const rowKey = keyFor(scope, keyHash, windowStart);
            const existing = rows.get(rowKey);

            rows.set(rowKey, {
              scope,
              key_hash: keyHash,
              window_start: windowStart,
              count: existing ? existing.count + 1 : 1,
              expires_at: expiresAt,
              updated_at: updatedAt
            });

            return result();
          }

          if (query.includes('DELETE FROM rate_limits WHERE scope = ? AND key_hash = ?')) {
            const [scope, keyHash] = values.map(String);

            for (const [key, row] of rows) {
              if (row.scope === scope && row.key_hash === keyHash) {
                rows.delete(key);
              }
            }

            return result();
          }

          throw new Error(`Unexpected fake D1 run query: ${query}`);
        },
        async first<T>() {
          if (!query.includes('SELECT count')) {
            throw new Error(`Unexpected fake D1 first query: ${query}`);
          }

          const [scope, keyHash, windowStart] = values.map(String);
          const row = rows.get(keyFor(scope, keyHash, windowStart));
          return (row ? { count: row.count } : null) as T | null;
        },
        async all<T>() {
          return { success: true, meta: {}, results: [] as T[] };
        }
      };

      return statement;
    },
    async batch<T>() {
      return [{ success: true, meta: {}, results: [] as T[] }];
    }
  };
}

async function withMockedFetch(
  fetchImpl: typeof fetch,
  test: () => Promise<void>
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;

  try {
    await test();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testRateLimit(): Promise<void> {
  const db = createFakeRateLimitDb();
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  const input = {
    scope: 'admin_login_ip',
    key: ' 2001:DB8::ABCD ',
    secret: 'x'.repeat(48),
    limit: 2,
    windowSeconds: 60
  };

  const first = await consumeRateLimitWithDb(db, input, now);
  const second = await consumeRateLimitWithDb(db, input, now + 1_000);
  const third = await consumeRateLimitWithDb(db, input, now + 2_000);
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);
  assert.equal(third.allowed, false);
  assert.equal(third.retryAfterSeconds, 58);

  const concurrent = await Promise.all(
    Array.from({ length: 5 }, () => consumeRateLimitWithDb(db, { ...input, key: 'parallel-key', limit: 3 }, now))
  );
  assert.ok(concurrent.filter((item) => item.allowed).length <= 3);
  assert.equal(db.rows().find((row) => row.count === 5)?.count, 5);

  const boundary = getRateLimitWindow(now + 59_500, 60);
  assert.equal(boundary.retryAfterSeconds, 1);

  await clearRateLimitWithDb(db, input);
  assert.equal(db.rows().some((row) => row.scope === input.scope && row.count === 3), false);

  db.seed(
    Array.from({ length: 150 }, (_, index) => ({
      scope: 'expired',
      key_hash: `hash-${index}`,
      window_start: '2025-12-31T23:00:00.000Z',
      count: 1,
      expires_at: '2025-12-31T23:01:00.000Z',
      updated_at: '2025-12-31T23:00:00.000Z'
    }))
  );
  await consumeRateLimitWithDb(db, { ...input, key: 'cleanup-key' }, now);
  assert.equal(db.rows().filter((row) => row.scope === 'expired').length, 50);
}

async function testExternalUrls(): Promise<void> {
  for (const value of [
    'http://localhost/',
    'http://localhost./',
    'http://127.0.0.1/',
    'http://127.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://0.0.0.0/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://192.168.0.1/',
    'http://169.254.169.254/',
    'http://100.64.0.1/',
    'http://224.0.0.1/',
    'http://240.0.0.1/',
    'http://[::1]/',
    'http://[::]/',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://metadata.google.internal/',
    'http://metadata/',
    'http://user:pass@example.com/',
    'file:///etc/passwd',
    '//example.com/path'
  ]) {
    expectUnsafeUrl(value);
  }

  for (const value of ['http://198.18.0.1/', 'http://192.0.2.1/', 'http://198.51.100.1/', 'http://203.0.113.1/']) {
    expectUnsafeUrl(value);
  }

  assert.equal(normalizePublicHttpUrl('https://example.com/a'), 'https://example.com/a');
  expectUnsafeUrl('//127.0.0.1/path', 'https://example.com/');

  await withMockedFetch(
    (async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/' } })) as typeof fetch,
    async () => {
      await assert.rejects(
        () => fetchPublicHttpStatusWithRedirects({ url: 'https://example.com/', method: 'HEAD', timeoutMs: 1000 }),
        UnsafeExternalUrlError
      );
    }
  );

  await withMockedFetch(
    (async () => new Response(null, { status: 302 })) as typeof fetch,
    async () => {
      await assert.rejects(
        () => fetchPublicHttpStatusWithRedirects({ url: 'https://example.com/', method: 'HEAD', timeoutMs: 1000 }),
        /Redirect limit/
      );
    }
  );

  await withMockedFetch(
    (async () => new Response(null, { status: 302, headers: { Location: '/next' } })) as typeof fetch,
    async () => {
      await assert.rejects(
        () => fetchPublicHttpStatusWithRedirects({ url: 'https://example.com/', method: 'HEAD', timeoutMs: 1000 }),
        /Redirect limit/
      );
    }
  );

  const signals: Array<AbortSignal | null> = [];
  const urls: string[] = [];
  await withMockedFetch(
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      signals.push(init?.signal ?? null);

      if (urls.length === 1) {
        return new Response(null, { status: 302, headers: { Location: '/one' } });
      }

      if (urls.length === 2) {
        return new Response(null, { status: 302, headers: { Location: '/two' } });
      }

      return new Response(null, { status: 204 });
    }) as typeof fetch,
    async () => {
      assert.equal(
        await fetchPublicHttpStatusWithRedirects({ url: 'https://example.com/', method: 'HEAD', timeoutMs: 1000 }),
        204
      );
      assert.equal(new Set(signals).size, 1);
      assert.deepEqual(urls, ['https://example.com/', 'https://example.com/one', 'https://example.com/two']);
    }
  );

  await withMockedFetch(
    ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      })) as typeof fetch,
    async () => {
      await assert.rejects(
        () => fetchPublicHttpStatusWithRedirects({ url: 'https://example.com/', method: 'HEAD', timeoutMs: 1 }),
        (error) => error instanceof DOMException && error.name === 'AbortError'
      );
    }
  );

  let bodyCancelled = false;
  await withMockedFetch(
    (async () =>
      new Response(
        new ReadableStream({
          cancel() {
            bodyCancelled = true;
          }
        }),
        { status: 200 }
      )) as typeof fetch,
    async () => {
      assert.equal(
        await fetchPublicHttpStatusWithRedirects({ url: 'https://example.com/', method: 'GET', timeoutMs: 1000 }),
        200
      );
      assert.equal(bodyCancelled, true);
    }
  );
}

function testRequests(): void {
  assert.equal(normalizeInternalRedirect('/write?post=p_1'), '/write?post=p_1');
  assert.equal(normalizeInternalRedirect('//evil.example'), '/write');
  assert.equal(normalizeInternalRedirect('https://evil.example'), '/write');
  assert.equal(normalizeInternalRedirect('/%5cevil.example'), '/write');
  assert.equal(normalizeInternalRedirect('/write%0d%0aLocation:https://evil.example'), '/write');

  assert.equal(
    isSameOriginBrowserRequest(
      new Request('https://blog.example/api/admin/posts', {
        method: 'POST',
        headers: { Origin: 'https://blog.example' }
      }),
      new URL('https://blog.example/api/admin/posts')
    ),
    true
  );
  assert.equal(
    isSameOriginBrowserRequest(
      new Request('https://blog.example/api/admin/posts', {
        method: 'POST',
        headers: { Origin: 'https://evil.example' }
      }),
      new URL('https://blog.example/api/admin/posts')
    ),
    false
  );
  assert.equal(
    isSameOriginBrowserRequest(
      new Request('https://blog.example/api/admin/posts', {
        method: 'POST',
        headers: { Origin: 'null' }
      }),
      new URL('https://blog.example/api/admin/posts')
    ),
    false
  );
  assert.equal(
    isSameOriginBrowserRequest(
      new Request('https://blog.example/api/admin/posts', {
        method: 'POST',
        headers: { 'Sec-Fetch-Site': 'cross-site' }
      }),
      new URL('https://blog.example/api/admin/posts')
    ),
    false
  );
  assert.equal(
    isSameOriginBrowserRequest(new Request('https://blog.example/api/admin/posts', { method: 'POST' }), new URL('https://blog.example/api/admin/posts')),
    true
  );

  const adminUrl = new URL('https://blog.example/api/admin/posts');
  assert.equal(
    isStrictSameOriginBrowserRequest(
      new Request(adminUrl, { method: 'POST', headers: { Origin: 'https://blog.example' } }),
      adminUrl
    ),
    true
  );
  assert.equal(
    isStrictSameOriginBrowserRequest(
      new Request(adminUrl, { method: 'POST', headers: { Origin: 'https://evil.example' } }),
      adminUrl
    ),
    false
  );
  assert.equal(isStrictSameOriginBrowserRequest(new Request(adminUrl, { method: 'POST' }), adminUrl), false);
  assert.equal(
    isStrictSameOriginBrowserRequest(new Request(adminUrl, { method: 'POST', headers: { Origin: 'null' } }), adminUrl),
    false
  );
  assert.equal(
    isStrictSameOriginBrowserRequest(new Request(adminUrl, { method: 'POST', headers: { Origin: 'not a url' } }), adminUrl),
    false
  );
  assert.equal(
    isStrictSameOriginBrowserRequest(
      new Request(adminUrl, {
        method: 'POST',
        headers: { Origin: 'https://blog.example', 'Sec-Fetch-Site': 'cross-site' }
      }),
      adminUrl
    ),
    false
  );
  assert.equal(
    isStrictSameOriginBrowserRequest(
      new Request(adminUrl, {
        method: 'POST',
        headers: { Origin: 'https://blog.example', 'Sec-Fetch-Site': 'same-origin' }
      }),
      adminUrl
    ),
    true
  );

  assert.equal(getClientAddress(new Request('https://blog.example/', { headers: { 'X-Forwarded-For': '8.8.8.8' } })), 'unknown');
  assert.equal(getClientAddress(new Request('https://blog.example/', { headers: { 'CF-Connecting-IP': '2001:DB8::1' } })), '2001:db8::1');
}

function testSiteUrl(): void {
  assert.equal(resolveSiteOrigin(undefined, true), 'http://localhost:4321');
  assert.throws(
    () => resolveSiteOrigin(undefined, false),
    (error) => error instanceof SiteUrlConfigurationError && error.message === 'SITE_URL must be configured in production.'
  );
  assert.throws(() => resolveSiteOrigin('not a url', false), /SITE_URL must be a valid absolute URL/);
  assert.throws(() => resolveSiteOrigin('/relative', false), /SITE_URL must be a valid absolute URL/);
  assert.throws(() => resolveSiteOrigin('http://blog.example', false), /SITE_URL must use https: in production/);
  assert.throws(() => resolveSiteOrigin('ftp://blog.example', false), /SITE_URL must use http: or https:/);
  assert.equal(resolveSiteOrigin('https://blog.example', false), 'https://blog.example');
  assert.equal(resolveSiteOrigin('https://blog.example/path?a=1#test', false), 'https://blog.example');
  assert.equal(resolveSiteOrigin('http://127.0.0.1:8787/path', true), 'http://127.0.0.1:8787');
  assert.throws(() => resolveSiteOrigin('http://127.0.0.1:8787', false), /SITE_URL must use https: in production/);
}

function testUploads(): void {
  assert.doesNotThrow(() =>
    assertValidImageFile(makeImageFile('PHOTO.PNG', 'image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  );
  assert.doesNotThrow(() =>
    assertValidImageFile(makeImageFile('photo.avatar.png', 'image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  );
  assert.throws(() => assertValidImageFile(makeImageFile('empty.png', 'image/png', [])), /empty/i);
  assert.throws(() => assertValidImageFile(makeImageFile('x.png.html', 'image/png', [1])), /extension/i);
  assert.throws(() => assertValidImageFile(makeImageFile('x.svg', 'image/svg+xml', [1])), /Only/);
  assert.throws(() => assertValidImageFile(makeImageFile('x.html', 'text/html', [1])), /Only/);

  assert.doesNotThrow(() =>
    assertValidImageBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png')
  );
  assert.doesNotThrow(() => assertValidImageBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'));
  assert.doesNotThrow(() => assertValidImageBytes(new Uint8Array([...Buffer.from('GIF89a')]), 'image/gif'));
  assert.doesNotThrow(() =>
    assertValidImageBytes(new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')]), 'image/webp')
  );
  assert.throws(
    () => assertValidImageBytes(new Uint8Array([0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74]), 'image/png'),
    /does not match/
  );
  assert.throws(() => assertValidImageBytes(new Uint8Array([0xff, 0xd8, 0xff]), 'image/png'), /does not match/);
  assert.throws(() => assertValidImageBytes(new Uint8Array([0x89, 0x50, 0x4e]), 'image/png'), /does not match/);
  assert.equal(sanitizeOriginalFilename('..\\evil/\r\nname.png'), '.._evil_name.png');
}

function testMarkdown(): void {
  const tokenA = 'A'.repeat(24);
  const tokenB = 'B'.repeat(24);
  const tokenC = 'C'.repeat(24);
  const markdownImages = [
    `![plain](asset:${tokenA})`,
    `![double](asset:${tokenA} "caption")`,
    `![single](asset:${tokenB} 'caption')`,
    `![paren](asset:${tokenC} (caption))`,
    `![ref][internal-ref]`,
    `[internal-ref]: asset:${tokenB} "caption"`,
    `![external](https://example.com/${tokenA}.png)`
  ].join('\n\n');

  assert.deepEqual(extractAssetTokens(markdownImages).sort(), [tokenA, tokenB, tokenC].sort());
  assert.equal(extractFirstImageUrl(`![ref][internal-ref]\n\n[internal-ref]: asset:${tokenB} "caption"`), `/i/${tokenB}`);
  assert.match(rewriteMarkdownAssetUrls(markdownImages, (token) => `asset:mapped-${token}`), /asset:mapped-/);
  assert.doesNotMatch(rewriteMarkdownAssetUrls(markdownImages, (token) => `asset:mapped-${token}`), /https:\/\/example\.com\/mapped-/);

  const maliciousMarkdown = [
    '<script>alert(1)</script>',
    '</script><script>alert(2)</script>',
    '[bad](javascript:alert(1))',
    '![bad](data:text/html;base64,PHNjcmlwdD4=)',
    '![svg](data:image/svg+xml;base64,PHN2Zy8+)',
    '<img src=x onerror=alert(1)>',
    '<svg><script>alert(1)</script></svg>',
    '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    '<iframe src="https://example.com"></iframe>',
    '<object data="https://example.com"></object>',
    '<embed src="https://example.com">',
    '<span style="background:url(javascript:alert(1))">x</span>',
    'line\u2028separator and paragraph\u2029separator',
    '[safe](https://example.com/)'
  ].join('\n\n');
  const sanitizedHtml = renderMarkdown(maliciousMarkdown);

  assert.doesNotMatch(sanitizedHtml, /<script\b/i);
  assert.doesNotMatch(sanitizedHtml, /<\/script/i);
  assert.doesNotMatch(sanitizedHtml, /\s(?:href|src)=["']javascript:/i);
  assert.doesNotMatch(sanitizedHtml, /\s(?:href|src)=["']data:text\/html/i);
  assert.doesNotMatch(sanitizedHtml, /\s(?:href|src)=["']data:image\/svg\+xml/i);
  assert.doesNotMatch(sanitizedHtml, /<[^>]+\sonerror\s*=/i);
  assert.doesNotMatch(sanitizedHtml, /<(iframe|object|embed|svg|math)\b/i);
  assert.doesNotMatch(sanitizedHtml, /<[^>]+\sstyle=/i);
  assert.match(sanitizedHtml, /href="https:\/\/example\.com\/"/);
}

await testRateLimit();
await testExternalUrls();
testRequests();
testSiteUrl();
testUploads();
testMarkdown();

console.log('Security checks passed.');
