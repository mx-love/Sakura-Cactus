import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { mountWalineComments } from '../src/lib/comments-client.ts';
import { getPublicCacheContext, matchPublicCache, maybeStorePublicCache, shouldForceNoStore } from '../src/lib/cache.ts';
import { SESSION_COOKIE_NAME } from '../src/features/auth/auth.constants.ts';

type WalineClient = Awaited<ReturnType<NonNullable<Parameters<typeof mountWalineComments>[1]>>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

class FakeElement extends EventTarget {
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  elements = new Map<string, FakeElement>();
  isConnected = true;
  hidden = false;
  disabled = false;
  textContent = '';

  querySelector(selector: string): FakeElement | null {
    return this.elements.get(selector) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  disconnected = false;

  constructor(private callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(): void {}

  disconnect(): void {
    this.disconnected = true;
  }

  enter(): void {
    this.callback([{ isIntersecting: true }]);
  }
}

function fixture() {
  const section = new FakeElement();
  const container = new FakeElement();
  const controls = new FakeElement();
  const status = new FakeElement();
  const button = new FakeElement();
  container.dataset.serverUrl = 'https://comments.example.com';
  container.dataset.pagePath = '/posts/original-slug';
  section.elements.set('#sakura-comments', container);
  section.elements.set('[data-waline-controls]', controls);
  section.elements.set('[data-waline-status]', status);
  section.elements.set('[data-waline-load]', button);
  return { section, container, controls, status, button };
}

async function testComments(): Promise<void> {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const observerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { pathname: '/posts/fallback' }, IntersectionObserver: FakeIntersectionObserver }
  });
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: FakeIntersectionObserver
  });

  try {
    const first = fixture();
    const pendingClient = deferred<WalineClient>();
    let loads = 0;
    let mounts = 0;
    let destroys = 0;
    let options: Record<string, unknown> | undefined;
    const cleanup = mountWalineComments(first.section as unknown as HTMLElement, async () => {
      loads += 1;
      return pendingClient.promise;
    });
    assert.equal(loads, 0, 'comments stay deferred outside the viewport');
    FakeIntersectionObserver.instances.at(-1)!.enter();
    first.button.dispatchEvent(new Event('click'));
    assert.equal(loads, 1, 'intersection and manual click share one pending mount');
    assert.equal(first.container.dataset.walineMounted, 'true');
    assert.equal(first.button.disabled, true);
    pendingClient.resolve({ init(value) { mounts += 1; options = value; return { destroy() { destroys += 1; } }; } });
    await tick();
    assert.equal(mounts, 1);
    assert.equal(options?.el, first.container);
    assert.equal(options?.serverURL, 'https://comments.example.com');
    assert.equal(options?.path, '/posts/original-slug');
    assert.equal(options?.dark, 'html[data-theme="dark"]');
    assert.equal(first.controls.hidden, true);
    first.button.dispatchEvent(new Event('click'));
    await tick();
    assert.equal(loads, 1, 'loaded comments retain the same instance');
    cleanup();
    cleanup();
    assert.equal(destroys, 1, 'navigation cleanup is idempotent');

    const retry = fixture();
    let attempts = 0;
    const warn = console.warn;
    console.warn = () => undefined;
    let cleanupRetry: (() => void) | undefined;
    try {
      cleanupRetry = mountWalineComments(retry.section as unknown as HTMLElement, async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('Network unavailable');
        return { init() { return {}; } };
      });
      retry.button.dispatchEvent(new Event('click'));
      await tick();
      assert.match(retry.status.textContent, /重试/);
      assert.equal(retry.button.disabled, false);
      assert.equal(retry.container.dataset.walineMounted, 'false');
      retry.button.dispatchEvent(new Event('click'));
      await tick();
      assert.equal(attempts, 2);
      assert.equal(retry.controls.hidden, true);
    } finally {
      console.warn = warn;
      cleanupRetry?.();
    }

    for (const leave of ['cleanup', 'detach']) {
      const removed = fixture();
      const client = deferred<{ init(): {} }>();
      let lateMounts = 0;
      const cleanupRemoved = mountWalineComments(removed.section as unknown as HTMLElement, () => client.promise);
      removed.button.dispatchEvent(new Event('click'));
      if (leave === 'cleanup') cleanupRemoved();
      else removed.container.isConnected = false;
      client.resolve({ init() { lateMounts += 1; return {}; } });
      await tick();
      assert.equal(lateMounts, 0, 'late CDN responses cannot mount into a departed page');
      assert.equal(removed.container.dataset.walineMounted, 'false');
      cleanupRemoved();
    }
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
    if (observerDescriptor) Object.defineProperty(globalThis, 'IntersectionObserver', observerDescriptor);
    else Reflect.deleteProperty(globalThis, 'IntersectionObserver');
  }
}

async function testTimedOutModuleRecovery(): Promise<void> {
  const source = readFileSync(new URL('../src/lib/comments-client.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: false }
  }).outputText;
  const exports: { mountWalineComments?: typeof mountWalineComments } = {};
  const requests: Array<{ url: string; client: ReturnType<typeof deferred<WalineClient>> }> = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  class LoadedStylesheet { sheet = {}; }
  const stylesheet = new LoadedStylesheet();

  // Execute the production loader with controllable CDN imports and a deterministic clock.
  runInNewContext(compiled, {
    exports,
    require(url: string) {
      const client = deferred<WalineClient>();
      requests.push({ url, client });
      return client.promise;
    },
    document: { getElementById: () => stylesheet },
    HTMLLinkElement: LoadedStylesheet,
    IntersectionObserver: FakeIntersectionObserver,
    window: {
      location: { pathname: '/posts/fallback' },
      IntersectionObserver: FakeIntersectionObserver,
      setTimeout(callback: () => void) { const id = ++nextTimer; timers.set(id, callback); return id; },
      clearTimeout(id: number) { timers.delete(id); }
    },
    console: { warn() {} }
  });
  assert.ok(exports.mountWalineComments);
  const mount = exports.mountWalineComments;
  const cleanups: Array<() => void> = [];
  const first = fixture();
  cleanups.push(mount(first.section as unknown as HTMLElement));

  function timeOut(): void {
    const callbacks = [...timers.values()];
    timers.clear();
    for (const callback of callbacks) callback();
  }

  try {
    first.button.dispatchEvent(new Event('click'));
    await tick();
    assert.equal(requests.length, 1);
    timeOut();
    await tick();
    assert.match(first.status.textContent, /重试/);

    first.button.dispatchEvent(new Event('click'));
    await tick();
    assert.equal(requests.length, 2, 'a timed-out import is requested again');
    assert.match(requests[1].url, /\?retry=1$/);

    requests[0].client.resolve({ init() { return {}; } });
    await tick();
    timeOut();
    await tick();
    first.button.dispatchEvent(new Event('click'));
    await tick();
    assert.equal(requests.length, 3, 'an old success cannot mark a newer pending request as loaded');
    assert.match(requests[2].url, /\?retry=2$/);

    requests[1].client.reject(new Error('Late obsolete request failure'));
    await tick();
    const second = fixture();
    cleanups.push(mount(second.section as unknown as HTMLElement));
    second.button.dispatchEvent(new Event('click'));
    await tick();
    assert.equal(requests.length, 3, 'an obsolete rejection cannot clear the newer cached request');

    requests[2].client.resolve({ init() { return {}; } });
    await tick();
    assert.equal(first.controls.hidden, true);
    assert.equal(second.controls.hidden, true);
    const third = fixture();
    cleanups.push(mount(third.section as unknown as HTMLElement));
    third.button.dispatchEvent(new Event('click'));
    await tick();
    assert.equal(requests.length, 3, 'successful modules stay reusable');
    assert.equal(third.controls.hidden, true);
  } finally {
    for (const cleanup of cleanups) cleanup();
  }
}

async function testCache(): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const writes: Array<{ request: Request; response: Response }> = [];
  let put = async (request: Request, response: Response) => { writes.push({ request, response }); };
  let cachedResponse: Response | undefined;
  let matches = 0;
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: { default: {
      put: (request: Request, response: Response) => put(request, response),
      match: async () => { matches += 1; return cachedResponse; }
    } }
  });
  const page = () => new Response('<main>public</main>', { headers: { 'Content-Type': 'text/html' } });

  try {
    for (const path of ['/about', '/about/', '/friends', '/friends/']) {
      const request = new Request(`https://blog.example.com${path}`);
      const context = getPublicCacheContext(request, new URL(request.url));
      assert.equal(context?.ttl, 60);
      assert.equal(context?.cacheKey.url.endsWith(path.replace(/\/$/, '')), true);
    }

    for (const path of ['/admin/login', '/write', '/settings', '/api/friends/apply', '/about?fresh=1']) {
      const request = new Request(`https://blog.example.com${path}`);
      assert.equal(shouldForceNoStore(request, new URL(request.url)), true);
      const result = await maybeStorePublicCache(request, new URL(request.url), page());
      assert.equal(result.headers.get('Cache-Control'), 'no-store');
    }
    assert.equal(writes.length, 0);

    const adminRequest = new Request('https://blog.example.com/friends', { headers: { Cookie: `${SESSION_COOKIE_NAME}=session` } });
    assert.equal(getPublicCacheContext(adminRequest, new URL(adminRequest.url)), null);
    assert.equal(await matchPublicCache(adminRequest, new URL(adminRequest.url)), null);
    assert.equal(matches, 0);

    const request = new Request('https://blog.example.com/about');
    const url = new URL(request.url);
    for (const cacheControl of ['private, max-age=60', 'no-store']) {
      const response = page();
      response.headers.set('Cache-Control', cacheControl);
      const result = await maybeStorePublicCache(request, url, response);
      assert.equal(result.headers.get('Cache-Control'), cacheControl);
    }
    const cookieResponse = page();
    cookieResponse.headers.set('Set-Cookie', 'test=value');
    await maybeStorePublicCache(request, url, cookieResponse);
    await maybeStorePublicCache(request, url, new Response('not found', { status: 404 }));
    assert.equal(writes.length, 0, 'private, cookie and error responses are never stored');

    const pending = deferred<void>();
    put = () => pending.promise;
    const backgroundTasks: Promise<unknown>[] = [];
    const response = await maybeStorePublicCache(request, url, page(), (task) => backgroundTasks.push(task));
    assert.equal(backgroundTasks.length, 1, 'Cloudflare receives a background cache-write task');
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=0, s-maxage=60, stale-while-revalidate=60');
    assert.equal(response.headers.get('X-Sakura-Cache'), 'MISS');
    assert.equal(await response.text(), '<main>public</main>', 'response is available while cache write is still pending');
    pending.resolve();
    await Promise.all(backgroundTasks);

    const fallback = deferred<void>();
    put = () => fallback.promise;
    let resolved = false;
    const fallbackResponse = maybeStorePublicCache(request, url, page()).then((value) => { resolved = true; return value; });
    await tick();
    assert.equal(resolved, false, 'runtimes without waitUntil await their write');
    fallback.resolve();
    await fallbackResponse;

    put = async () => { throw new Error('Cache offline'); };
    assert.equal((await maybeStorePublicCache(request, url, page())).status, 200);
    cachedResponse = page();
    assert.equal((await matchPublicCache(request, url))?.headers.get('X-Sakura-Cache'), 'HIT');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'caches', descriptor);
    else Reflect.deleteProperty(globalThis, 'caches');
  }
}

await testComments();
await testTimedOutModuleRecovery();
await testCache();
console.log('Comments lazy loading and public cache regression checks passed.');
