import { createDialogFocus } from './dialog-focus';
import { getSiteDateParts, formatSiteDate } from './site-time-core';

export interface SearchPost {
  title: string;
  excerpt: string;
  slug: string;
  publishedAt: string | null;
  tags: string[];
  searchableText: string;
}

export interface SearchState {
  query: string;
  status: 'idle' | 'loading' | 'success' | 'error';
  posts: SearchPost[];
}

function getSearchDateTerms(value: string | null): string[] {
  if (!value) return [];
  const { year, month, day } = getSiteDateParts(value);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');

  return [
    `${year}/${mm}/${dd}`, `${year}-${mm}-${dd}`,
    `${year}年${month}月${day}日`, `${year}年${mm}月${dd}日`,
    `${month}月${day}日`, `${mm}/${dd}`, `${month}/${day}`, `${day}日`, `${day}号`,
    `${year}年${month}月`, `${year}年${mm}月`, `${year}/${mm}`,
    `${year}-${month}`, `${year}-${mm}`, String(year)
  ];
}

export function normalizeSearchPost(value: unknown): SearchPost | null {
  if (!value || typeof value !== 'object') return null;
  const post = value as Record<string, unknown>;
  if (typeof post.title !== 'string' || typeof post.slug !== 'string' || !post.slug) return null;

  const title = post.title;
  const excerpt = typeof post.excerpt === 'string' ? post.excerpt : '';
  const tags = Array.isArray(post.tags) ? post.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  const date = post.published_at ?? post.publishedAt;
  const publishedAt = typeof date === 'string' && Number.isFinite(Date.parse(date)) ? date : null;

  return {
    title,
    excerpt,
    slug: post.slug,
    publishedAt,
    tags,
    searchableText: [title, excerpt, ...tags, ...getSearchDateTerms(publishedAt)].join(' ').toLowerCase()
  };
}

export function createSearchIndexLoader(request: typeof fetch = fetch) {
  let posts: SearchPost[] | null = null;
  let pending: Promise<SearchPost[]> | null = null;

  return function loadSearchIndex(): Promise<SearchPost[]> {
    if (posts) return Promise.resolve(posts);
    pending ??= request('/api/search-index', { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Search index request failed.');
        const payload = await response.json();
        if (!Array.isArray(payload?.data?.posts)) throw new Error('Invalid search index.');

        const normalizedPosts: SearchPost[] = payload.data.posts
          .map(normalizeSearchPost)
          .filter((post: SearchPost | null): post is SearchPost => post !== null);
        posts = normalizedPosts;
        return normalizedPosts;
      })
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
    return pending;
  };
}

export function createSearchController(loadIndex: () => Promise<SearchPost[]>, render: (state: SearchState) => void) {
  let revision = 0;

  async function search(value: string): Promise<void> {
    const currentRevision = ++revision;
    const query = value.trim().toLowerCase();
    if (!query) {
      render({ query, status: 'idle', posts: [] });
      return;
    }

    render({ query, status: 'loading', posts: [] });
    try {
      const posts = await loadIndex();
      if (currentRevision !== revision) return;
      render({ query, status: 'success', posts: posts.filter((post) => post.searchableText.includes(query)) });
    } catch {
      if (currentRevision !== revision) return;
      render({ query, status: 'error', posts: [] });
    }
  }

  function reset(): void {
    revision += 1;
    render({ query: '', status: 'idle', posts: [] });
  }

  return { search, reset };
}

const loadSearchIndex = createSearchIndexLoader();

function appendHighlightedText(parent: HTMLElement, value: string, query: string): void {
  const normalizedText = value.toLowerCase();
  let cursor = 0;
  let index = normalizedText.indexOf(query);

  while (index !== -1) {
    if (index > cursor) parent.append(document.createTextNode(value.slice(cursor, index)));
    const mark = document.createElement('mark');
    mark.className = 'sc-search-highlight';
    mark.textContent = value.slice(index, index + query.length);
    parent.append(mark);
    cursor = index + query.length;
    index = normalizedText.indexOf(query, cursor);
  }
  if (cursor < value.length) parent.append(document.createTextNode(value.slice(cursor)));
}

function createTags(tags: string[], query: string): HTMLElement {
  const list = document.createElement('div');
  list.className = 'sc-tag-list sc-search-result-tags';
  for (const tag of tags) {
    const item = document.createElement('span');
    item.className = 'sc-tag-link sc-tag-link-static';
    appendHighlightedText(item, tag, query);
    list.append(item);
  }
  return list;
}

function createOverlayResult(post: SearchPost, query: string): HTMLElement {
  const link = document.createElement('a');
  link.href = `/posts/${encodeURIComponent(post.slug)}`;
  link.dataset.astroPrefetch = 'hover';
  link.className = 'sc-search-overlay-result';
  const title = document.createElement('strong');
  appendHighlightedText(title, post.title, query);
  link.append(title);
  if (post.publishedAt) {
    const meta = document.createElement('small');
    const time = document.createElement('time');
    time.dateTime = post.publishedAt;
    time.textContent = formatSiteDate(post.publishedAt);
    meta.append(time);
    link.append(meta);
  }
  if (post.excerpt) {
    const excerpt = document.createElement('span');
    appendHighlightedText(excerpt, post.excerpt, query);
    link.append(excerpt);
  }
  if (post.tags.length) link.append(createTags(post.tags, query));
  return link;
}

/** Search-page results reuse the editorial index entry markup (see PostIndex.astro). */
function createPageResult(post: SearchPost, query: string, index: number): HTMLElement {
  const entry = document.createElement('article');
  entry.className = 'sc-index-entry';
  entry.style.setProperty('--sc-entry-index', String(Math.min(index, 9)));

  const number = document.createElement('span');
  const label = String(index + 1).padStart(2, '0');
  number.className = 'sc-index-no';
  number.dataset.digits = label.length > 2 ? '3' : '2';
  number.setAttribute('aria-hidden', 'true');
  number.textContent = `No.${label}`;

  const body = document.createElement('div');
  body.className = 'sc-index-body';
  const heading = document.createElement('h2');
  heading.className = 'sc-index-title';
  const link = document.createElement('a');
  link.className = 'sc-draw-link';
  link.href = `/posts/${encodeURIComponent(post.slug)}`;
  link.dataset.astroPrefetch = 'hover';
  appendHighlightedText(link, post.title, query);
  heading.append(link);
  body.append(heading);

  if (post.publishedAt || post.tags.length) {
    const meta = document.createElement('p');
    meta.className = 'sc-label sc-index-meta';
    if (post.publishedAt) {
      const time = document.createElement('time');
      time.dateTime = post.publishedAt;
      time.textContent = formatSiteDate(post.publishedAt).replaceAll('/', '.');
      meta.append(time);
    }
    for (const tag of post.tags) {
      const item = document.createElement('span');
      item.className = 'sc-index-tag';
      item.append(document.createTextNode('#'));
      appendHighlightedText(item, tag, query);
      meta.append(item);
    }
    body.append(meta);
  }

  if (post.excerpt) {
    const excerpt = document.createElement('p');
    excerpt.className = 'sc-index-excerpt';
    appendHighlightedText(excerpt, post.excerpt, query);
    body.append(excerpt);
  }

  entry.append(number, body);
  return entry;
}

function bindSearch(root: HTMLElement): void {
  if (root.dataset.searchBound === 'true') return;
  const input = root.querySelector<HTMLInputElement>('[data-search-input]');
  const results = root.querySelector<HTMLElement>('[data-search-results]');
  const status = root.querySelector<HTMLElement>('[data-search-status]');
  const retry = root.querySelector<HTMLButtonElement>('[data-search-retry]');
  if (!input || !results || !status || !retry) return;
  root.dataset.searchBound = 'true';

  const overlay = root.dataset.siteSearch === 'overlay';
  const emptyTemplate = root.querySelector<HTMLTemplateElement>('[data-search-empty]');
  const controller = createSearchController(loadSearchIndex, (state) => {
    const fragment = document.createDocumentFragment();
    const loading = state.status === 'loading';
    results.setAttribute('aria-busy', String(loading));
    retry.hidden = state.status !== 'error';
    let message = '';

    if (loading) message = '正在翻找纸页……';
    if (state.status === 'error') message = '搜索暂时不可用，请重试。';
    if (state.status === 'success') {
      const matched = overlay ? state.posts.slice(0, 8) : state.posts;
      if (state.posts.length === 0) {
        message = overlay ? '没有翻到相关纸页。' : '0 篇文章';
        if (emptyTemplate) fragment.append(emptyTemplate.content.cloneNode(true));
      } else {
        message = `${state.posts.length} 篇文章`;
        if (overlay && state.posts.length > 8) message += '，显示前 8 篇';
        matched.forEach((post, index) => fragment.append(overlay ? createOverlayResult(post, state.query) : createPageResult(post, state.query, index)));
      }
    }

    status.textContent = message;
    status.hidden = overlay && !message;
    results.replaceChildren(fragment);
  });

  function search(): void {
    void controller.search(input!.value);
  }

  input.addEventListener('input', search);
  input.addEventListener('focus', () => {
    void loadSearchIndex().catch(() => undefined);
  });
  retry.addEventListener('click', () => {
    input.focus({ preventScroll: true });
    search();
  });
  controller.reset();

  if (!overlay) return;
  const dialog = root.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) return;
  const focus = createDialogFocus(dialog, { initialFocus: input, onEscape: closeSearch });

  function openSearch(trigger?: HTMLElement): void {
    if (!root.hidden) {
      input!.focus({ preventScroll: true });
      return;
    }
    const anotherDialogOpen = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], dialog[open]'))
      .some((element) => !root.contains(element) && !element.closest('[hidden]') && element.getClientRects().length > 0);
    if (anotherDialogOpen) return;
    const documentRoot = document.documentElement;
    const scrollbarWidth = Math.max(0, window.innerWidth - documentRoot.clientWidth);
    const existingPadding = Number.parseFloat(window.getComputedStyle(documentRoot).paddingInlineEnd) || 0;
    documentRoot.style.setProperty('--sc-search-inline-padding', `${existingPadding + scrollbarWidth}px`);
    root.hidden = false;
    documentRoot.classList.add('sc-search-open');
    focus.activate(trigger);
    input!.focus({ preventScroll: true });
    search();
  }

  function closeSearch(): void {
    focus.deactivate();
    root.hidden = true;
    unlockSearchScroll();
    input!.value = '';
    controller.reset();
  }

  function unlockSearchScroll(): void {
    document.documentElement.classList.remove('sc-search-open');
    document.documentElement.style.removeProperty('--sc-search-inline-padding');
  }

  document.querySelectorAll<HTMLElement>('[data-search-open]').forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      if (event instanceof MouseEvent && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return;
      event.preventDefault();
      openSearch(trigger);
    });
  });
  root.querySelectorAll('[data-search-close]').forEach((trigger) => {
    trigger.addEventListener('click', closeSearch);
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearch();
    }
  });
  window.addEventListener('pagehide', () => {
    focus.deactivate({ restoreFocus: false });
    root.hidden = true;
    unlockSearchScroll();
    input.value = '';
    controller.reset();
  });
}

export function bindSiteSearch(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-site-search]').forEach(bindSearch);
}
