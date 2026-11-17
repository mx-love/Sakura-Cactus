const WALINE_SCRIPT_URL = 'https://unpkg.com/@waline/client@3.16.2/dist/waline.js';
const WALINE_STYLE_URL = 'https://unpkg.com/@waline/client@3.16.2/dist/waline.css';
const WALINE_STYLE_ID = 'sakura-waline-styles';

interface WalineInstance {
  destroy?: () => void;
}

interface WalineClient {
  init(options: {
    el: HTMLElement;
    serverURL: string;
    path: string;
    lang: string;
    dark: string;
  }): WalineInstance | void;
}

let clientPromise: Promise<WalineClient> | undefined;
let clientLoaded = false;
const stylesheetRequests = new WeakMap<HTMLLinkElement, Promise<void>>();
let failedModuleLoads = 0;

function loadWalineStyles(): Promise<void> {
  const existing = document.getElementById(WALINE_STYLE_ID);

  if (existing instanceof HTMLLinkElement && existing.sheet) {
    return Promise.resolve();
  }

  const link = existing instanceof HTMLLinkElement ? existing : document.createElement('link');
  const pendingRequest = stylesheetRequests.get(link);
  if (pendingRequest) return pendingRequest;

  const stylesheetPromise = new Promise<void>((resolve, reject) => {
    link.id = WALINE_STYLE_ID;
    link.rel = 'stylesheet';
    link.href = WALINE_STYLE_URL;

    const timeout = window.setTimeout(() => finish(new Error('Waline stylesheet timed out.')), 20_000);

    function finish(error?: Error): void {
      window.clearTimeout(timeout);
      link.removeEventListener('load', loaded);
      link.removeEventListener('error', failed);

      if (error) {
        link.remove();
        reject(error);
      } else {
        resolve();
      }
    }

    function loaded(): void {
      finish();
    }

    function failed(): void {
      finish(new Error('Waline stylesheet failed to load.'));
    }

    link.addEventListener('load', loaded, { once: true });
    link.addEventListener('error', failed, { once: true });

    if (!link.isConnected) {
      document.head.append(link);
    }
  });

  stylesheetRequests.set(link, stylesheetPromise);
  return stylesheetPromise;
}

function loadWalineModule(): Promise<WalineClient> {
  if (!clientPromise) {
    const scriptUrl = failedModuleLoads ? `${WALINE_SCRIPT_URL}?retry=${failedModuleLoads}` : WALINE_SCRIPT_URL;
    clientLoaded = false;

    const request = import(/* @vite-ignore */ scriptUrl)
      .then((client: WalineClient) => {
        if (typeof client.init !== 'function') {
          throw new Error('Waline init is not available.');
        }

        if (clientPromise === request) clientLoaded = true;
        return client;
      })
      .catch((error: unknown) => {
        if (clientPromise === request) {
          failedModuleLoads += 1;
          clientPromise = undefined;
        }
        throw error;
      });

    clientPromise = request;
  }

  return clientPromise;
}

async function loadWalineClient(): Promise<WalineClient> {
  let timeout = 0;
  const moduleRequest = loadWalineModule();

  try {
    return await Promise.race([
      Promise.all([loadWalineStyles(), moduleRequest]).then(([, client]) => client),
      new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(() => {
          if (clientPromise === moduleRequest && !clientLoaded) {
            failedModuleLoads += 1;
            clientPromise = undefined;
          }
          reject(new Error('Waline client timed out.'));
        }, 20_000);
      })
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
}

export function mountWalineComments(
  section: HTMLElement,
  loadClient: () => Promise<WalineClient> = loadWalineClient
): () => void {
  const container = section.querySelector<HTMLElement>('#sakura-comments');
  const controls = section.querySelector<HTMLElement>('[data-waline-controls]');
  const status = section.querySelector<HTMLElement>('[data-waline-status]');
  const button = section.querySelector<HTMLButtonElement>('[data-waline-load]');

  if (!container || !controls || !status || !button || container.dataset.walineMounted === 'true') {
    return () => undefined;
  }

  let disposed = false;
  let loading = false;
  let instance: WalineInstance | void;
  let observer: IntersectionObserver | undefined;

  const load = async (): Promise<void> => {
    if (disposed || loading || container.dataset.walineMounted === 'true') return;

    observer?.disconnect();
    loading = true;
    container.dataset.walineMounted = 'true';
    container.setAttribute('aria-busy', 'true');
    button.disabled = true;
    status.textContent = '正在加载评论……';

    try {
      const serverURL = container.dataset.serverUrl ?? '';
      if (!serverURL.startsWith('https://')) throw new Error('Invalid Waline server URL.');
      const client = await loadClient();

      if (disposed || !container.isConnected) return;

      instance = client.init({
        el: container,
        serverURL,
        path: container.dataset.pagePath || window.location.pathname,
        lang: 'zh-CN',
        dark: 'html[data-theme="dark"]'
      });
      controls.hidden = true;
    } catch (error) {
      container.dataset.walineMounted = 'false';

      if (!disposed && container.isConnected) {
        status.textContent = '评论暂时无法加载，请重试。';
        button.textContent = '重试加载评论';
        console.warn('Waline failed to initialize.', error);
      }
    } finally {
      loading = false;
      container.setAttribute('aria-busy', 'false');

      if (disposed || !container.isConnected) {
        container.dataset.walineMounted = 'false';
      }

      if (!disposed) button.disabled = false;
    }
  };

  function onLoadClick(): void {
    void load();
  }

  button.addEventListener('click', onLoadClick);

  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void load();
    }, { rootMargin: '400px 0px' });
    observer.observe(section);
  } else {
    void load();
  }

  return () => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    button.removeEventListener('click', onLoadClick);

    try {
      instance?.destroy?.();
    } catch (error) {
      console.warn('Waline failed to clean up.', error);
    } finally {
      container.dataset.walineMounted = 'false';
    }
  };
}

let initialized = false;
let activeSection: HTMLElement | null = null;
let disposeActive: (() => void) | undefined;

export function setupWalineComments(): void {
  if (initialized) return;
  initialized = true;

  function dispose(): void {
    disposeActive?.();
    disposeActive = undefined;
    activeSection = null;
  }

  function bind(): void {
    const section = document.querySelector<HTMLElement>('[data-waline-section]');
    if (section && section === activeSection) return;
    dispose();
    activeSection = section;
    if (section) disposeActive = mountWalineComments(section);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }

  document.addEventListener('astro:page-load', bind);
  document.addEventListener('astro:before-swap', dispose);
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) dispose();
  });
}
