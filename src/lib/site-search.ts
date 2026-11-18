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

function createTags(tags: string[], query: string, overlay: boolean): HTMLElement {
  const list = document.createElement('div');
  list.className = overlay ? 'sc-tag-list sc-search-result-tags' : 'sc-tag-list';
  for (const tag of tags) {
    const item = document.createElement('span');
    item.className = 'sc-tag-link sc-tag-link-static';
    appendHighlightedText(item, tag, query);
    list.append(item);
  }
  return list;
}

function createResult(post: SearchPost, query: string, overlay: boolean): HTMLElement {
  const link = document.createElement('a');
  link.href = `/posts/${encodeURIComponent(post.slug)}`;
  link.dataset.astroPrefetch = 'hover';
  if (overlay) link.className = 'sc-search-overlay-result';

  const title = document.createElement(overlay ? 'strong' : 'h2');
  let result: HTMLElement = link;
  if (overlay) {
    appendHighlightedText(title, post.title, query);
    link.append(title);
  } else {
    result = document.createElement('article');
    result.className = 'sc-post-entry';
    appendHighlightedText(link, post.title, query);
    title.append(link);
    result.append(title);
  }

  if (post.publishedAt) {
    const meta = document.createElement(overlay ? 'small' : 'p');
    const time = document.createElement('time');
    time.dateTime = post.publishedAt;
    time.textContent = formatSiteDate(post.publishedAt);
    if (!overlay) {
      meta.className = 'sc-post-meta';
      const icon = document.createElement('span');
      icon.className = 'sc-calendar-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2v4"/><path d="M16 2v4"/><path d="M3 10h18"/><rect x="3" y="4" width="18" height="18" rx="2"/></svg>';
      meta.append(icon);
    }
    meta.append(time);
    result.append(meta);
  }

  if (post.excerpt) {
    const excerpt = document.createElement(overlay ? 'span' : 'p');
    if (!overlay) excerpt.className = 'sc-post-excerpt';
    appendHighlightedText(excerpt, post.excerpt, query);
    result.append(excerpt);
  }
  if (post.tags.length) result.append(createTags(post.tags, query, overlay));
  return result;
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
        for (const post of matched) fragment.append(createResult(post, state.query, overlay));
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
    const anotherDialogOpen = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], dialog[open]'))
      .some((element) => !root.contains(element) && !element.closest('[hidden]') && element.getClientRects().length > 0);
    if (anotherDialogOpen) return;
    root.hidden = false;
    document.documentElement.classList.add('sc-search-open');
    focus.activate(trigger);
    input!.focus({ preventScroll: true });
    search();
  }

  function closeSearch(): void {
    focus.deactivate();
    root.hidden = true;
    document.documentElement.classList.remove('sc-search-open');
    input!.value = '';
    controller.reset();
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
    document.documentElement.classList.remove('sc-search-open');
    input.value = '';
    controller.reset();
  });
}

export function bindSiteSearch(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-site-search]').forEach(bindSearch);
}
