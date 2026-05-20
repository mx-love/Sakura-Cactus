function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed.startsWith('/') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('mailto:')
  );
}

function renderInline(markdown: string): string {
  let html = escapeHtml(markdown);

  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, rawUrl: string) => {
    const url = rawUrl.trim();

    if (!isSafeUrl(url)) {
      return escapeHtml(alt);
    }

    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
  });
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, rawUrl: string) => {
    const url = rawUrl.trim();

    if (!isSafeUrl(url)) {
      return label;
    }

    const externalAttrs = url.startsWith('http://') || url.startsWith('https://') ? ' rel="noopener noreferrer"' : '';
    return `<a href="${escapeHtml(url)}"${externalAttrs}>${label}</a>`;
  });

  return html;
}

function renderParagraph(lines: string[]): string {
  return `<p>${renderInline(lines.join(' '))}</p>`;
}

function renderList(items: string[], ordered: boolean): string {
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`;
}

export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<(iframe|object|embed|style)\b[^>]*>.*?<\/\1>/gis, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, ' $1="#"')
    .replace(/\s+(href|src)\s*=\s*javascript:[^\s>]+/gi, ' $1="#"');
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

  for (const line of lines) {
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

  return sanitizeHtml(output.join('\n'));
}

export function calculateWordCount(markdown: string): number {
  const latinWords = markdown.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  const cjkChars = markdown.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return latinWords + cjkChars;
}

export function calculateReadingTimeMinutes(markdown: string): number {
  return Math.max(1, Math.ceil(calculateWordCount(markdown) / 300));
}
