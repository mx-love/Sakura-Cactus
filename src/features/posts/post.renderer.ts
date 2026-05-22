function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ASSET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,64}$/;
const HTML_TOKEN_PREFIX = 'SC_MARKDOWN_TOKEN_';

function isSafeAnchorUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  return trimmed.startsWith('https://') || trimmed.startsWith('http://') || trimmed.startsWith('mailto:');
}

function isSafeImageUrl(url: string): boolean {
  const trimmed = url.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('https://') || lower.startsWith('http://') || trimmed.startsWith('/i/')) {
    return true;
  }

  if (trimmed.startsWith('asset:')) {
    return ASSET_TOKEN_PATTERN.test(trimmed.slice('asset:'.length).trim());
  }

  return false;
}

function normalizeImageUrl(url: string): string {
  const trimmed = url.trim();

  if (!trimmed.startsWith('asset:')) {
    return trimmed;
  }

  return `/i/${trimmed.slice('asset:'.length).trim()}`;
}

function renderImage(alt: string, rawUrl: string): string {
  const url = rawUrl.trim();

  if (!isSafeImageUrl(url)) {
    return escapeHtml(alt);
  }

  return `<img src="${escapeHtml(normalizeImageUrl(url))}" alt="${escapeHtml(alt)}" loading="lazy" />`;
}

function renderLink(label: string, rawUrl: string): string {
  const url = rawUrl.trim();

  if (!isSafeAnchorUrl(url)) {
    return escapeHtml(label);
  }

  const externalAttrs = url.startsWith('http://') || url.startsWith('https://') ? ' rel="noopener noreferrer"' : '';
  return `<a href="${escapeHtml(url)}"${externalAttrs}>${escapeHtml(label)}</a>`;
}

export function extractFirstImageUrl(markdown: string): string | null {
  const pattern = /!\[[^\]]*]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markdown)) !== null) {
    const url = match[1].trim();

    if (url.startsWith('asset:')) {
      const token = url.slice('asset:'.length).trim();
      return ASSET_TOKEN_PATTERN.test(token) ? `/i/${token}` : null;
    }

    if (isSafeImageUrl(url)) {
      return normalizeImageUrl(url);
    }
  }

  return null;
}

function renderInline(markdown: string): string {
  const htmlTokens: string[] = [];

  function stash(html: string): string {
    const token = `${HTML_TOKEN_PREFIX}${htmlTokens.length}__`;
    htmlTokens.push(html);
    return token;
  }

  let tokenizedMarkdown = markdown;

  tokenizedMarkdown = tokenizedMarkdown.replace(/`([^`]+)`/g, (_match, value: string) => {
    return stash(`<code>${escapeHtml(value)}</code>`);
  });
  tokenizedMarkdown = tokenizedMarkdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, rawUrl: string) => {
    return stash(renderImage(alt, rawUrl));
  });
  tokenizedMarkdown = tokenizedMarkdown.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, rawUrl: string) => {
    return stash(renderLink(label, rawUrl));
  });

  let html = escapeHtml(tokenizedMarkdown);

  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/(^|[\s(])((?:https?:\/\/)[^\s<]+)/g, (_match, prefix: string, rawUrl: string) => {
    const url = rawUrl.replace(/[),.;!?]+$/, '');
    const trailing = rawUrl.slice(url.length);

    if (!isSafeAnchorUrl(url)) {
      return `${prefix}${rawUrl}`;
    }

    return `${prefix}${stash(renderLink(url, url))}${trailing}`;
  });

  return html.replace(new RegExp(`${HTML_TOKEN_PREFIX}(\\d+)__`, 'g'), (_match, index: string) => {
    return htmlTokens[Number(index)] ?? '';
  });
}

export function extractAssetTokens(markdown: string): string[] {
  const tokens = new Set<string>();
  const pattern = /!\[[^\]]*]\(\s*asset:([A-Za-z0-9_-]{24,64})\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markdown)) !== null) {
    tokens.add(match[1]);
  }

  return [...tokens];
}

function renderParagraph(lines: string[]): string {
  return `<p>${renderInline(lines.join(' '))}</p>`;
}

function renderListItem(item: string): string {
  const task = item.match(/^\[( |x|X)]\s+(.+)$/);

  if (!task) {
    return `<li>${renderInline(item)}</li>`;
  }

  const checked = task[1].toLowerCase() === 'x';
  const marker = checked ? '☑' : '☐';
  return `<li><span class="sc-task-checkbox" aria-hidden="true">${marker}</span>${renderInline(task[2])}</li>`;
}

function renderList(items: string[], ordered: boolean): string {
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${items.map((item) => renderListItem(item)).join('')}</${tag}>`;
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = parseTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderTable(lines: string[]): string {
  const [headerLine, _separator, ...bodyLines] = lines;
  const headerCells = parseTableRow(headerLine);
  const bodyRows = bodyLines.map(parseTableRow);
  const thead = `<thead><tr>${headerCells.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead>`;
  const tbody =
    bodyRows.length > 0
      ? `<tbody>${bodyRows
          .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
          .join('')}</tbody>`
      : '';

  return `<table>${thead}${tbody}</table>`;
}

export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const output: string[] = [];
  let paragraph: string[] = [];
  let unorderedList: string[] = [];
  let orderedList: string[] = [];
  let inCodeFence = false;
  let codeLines: string[] = [];

  function flushParagraph() {
    if (paragraph.length > 0) {
      output.push(renderParagraph(paragraph));
      paragraph = [];
    }
  }

  function flushLists() {
    if (unorderedList.length > 0) {
      output.push(renderList(unorderedList, false));
      unorderedList = [];
    }

    if (orderedList.length > 0) {
      output.push(renderList(orderedList, true));
      orderedList = [];
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.trim().startsWith('```')) {
      flushParagraph();
      flushLists();

      if (inCodeFence) {
        output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
        inCodeFence = false;
      } else {
        inCodeFence = true;
      }

      continue;
    }

    if (inCodeFence) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushLists();
      continue;
    }

    if (index + 1 < lines.length && trimmed.includes('|') && isTableSeparator(lines[index + 1])) {
      flushParagraph();
      flushLists();
      const tableLines = [trimmed, lines[index + 1].trim()];
      index += 2;

      while (index < lines.length && lines[index].trim().includes('|') && lines[index].trim()) {
        tableLines.push(lines[index].trim());
        index += 1;
      }

      index -= 1;
      output.push(renderTable(tableLines));
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);

    if (heading) {
      flushParagraph();
      flushLists();
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);

    if (unordered) {
      flushParagraph();
      orderedList = [];
      unorderedList.push(unordered[1]);
      continue;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);

    if (ordered) {
      flushParagraph();
      unorderedList = [];
      orderedList.push(ordered[1]);
      continue;
    }

    if (trimmed.startsWith('> ')) {
      flushParagraph();
      flushLists();
      output.push(`<blockquote>${renderInline(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    flushLists();
    paragraph.push(trimmed);
  }

  if (inCodeFence) {
    output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }

  flushParagraph();
  flushLists();

  return output.join('\n');
}

export function calculateWordCount(markdown: string): number {
  const latinWords = markdown.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  const cjkChars = markdown.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return latinWords + cjkChars;
}

export function calculateReadingTimeMinutes(markdown: string): number {
  return Math.max(1, Math.ceil(calculateWordCount(markdown) / 300));
}
