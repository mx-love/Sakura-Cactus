import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

const ASSET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,64}$/;
const CALLOUT_TYPES = new Set(['note', 'tip', 'important', 'warning', 'caution', 'quote']);
const CALLOUT_MARKER_PATTERN = /^\s*\[!([A-Za-z]+)\](?:[ \t]*(?:\r?\n)?[ \t]*)?/;

export interface MarkdownHeading {
  depth: 2 | 3;
  text: string;
  slug: string;
}

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

function visitTree(node: any, visitor: (node: any, index?: number, parent?: any) => void, parent?: any) {
  if (!node || typeof node !== 'object') {
    return;
  }

  visitor(node, undefined, parent);

  if (!Array.isArray(node.children)) {
    return;
  }

  for (let index = 0; index < node.children.length; index += 1) {
    visitTree(node.children[index], (child) => visitor(child, index, node), node);
  }
}

function getNodeText(node: any): string {
  if (!node || typeof node !== 'object') {
    return '';
  }

  if (node.type === 'text') {
    return String(node.value ?? '');
  }

  if (!Array.isArray(node.children)) {
    return '';
  }

  return node.children.map(getNodeText).join('');
}

function createSlugger() {
  const seen = new Map<string, number>();

  return (value: string): string => {
    const normalized = value
      .normalize('NFKD')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '');
    const base = normalized || 'section';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };
}

function remarkEscapeRawHtml() {
  return (tree: any) => {
    visitTree(tree, (node) => {
      if (node.type === 'html') {
        node.type = 'text';
      }
    });
  };
}

function rehypeRewriteAssetImages() {
  return (tree: any) => {
    visitTree(tree, (node) => {
      if (node.type !== 'element' || node.tagName !== 'img') {
        return;
      }

      const src = typeof node.properties?.src === 'string' ? node.properties.src : '';

      if (!isSafeImageUrl(src)) {
        delete node.properties.src;
        return;
      }

      node.properties.src = normalizeImageUrl(src);
    });
  };
}

function rehypeHardenLinksAndImages() {
  return (tree: any) => {
    visitTree(tree, (node) => {
      if (node.type !== 'element') {
        return;
      }

      if (node.tagName === 'a') {
        const href = typeof node.properties?.href === 'string' ? node.properties.href : '';

        if (!isSafeAnchorUrl(href)) {
          delete node.properties.href;
          return;
        }

        if (href.startsWith('http://') || href.startsWith('https://')) {
          node.properties.rel = ['noopener', 'noreferrer'];
        }
      }

      if (node.tagName === 'img') {
        const src = typeof node.properties?.src === 'string' ? node.properties.src : '';

        if (!src || !isSafeImageUrl(src)) {
          delete node.properties.src;
          return;
        }

        node.properties.loading = 'lazy';
      }
    });
  };
}

function appendClassName(node: any, className: string) {
  node.properties = node.properties ?? {};
  const current = node.properties.className;

  if (Array.isArray(current)) {
    if (!current.includes(className)) {
      current.push(className);
    }
    return;
  }

  if (typeof current === 'string' && current.length > 0) {
    node.properties.className = current.split(/\s+/).includes(className) ? current : `${current} ${className}`;
    return;
  }

  node.properties.className = [className];
}

function isWhitespaceText(node: any): boolean {
  return node?.type === 'text' && String(node.value ?? '').trim() === '';
}

function isEmptyElement(node: any): boolean {
  return !Array.isArray(node?.children) || node.children.every(isWhitespaceText);
}

function isImageOnlyParagraph(node: any): boolean {
  if (node?.type !== 'element' || node.tagName !== 'p' || !Array.isArray(node.children)) {
    return false;
  }

  const meaningfulChildren = node.children.filter((child: any) => !isWhitespaceText(child));
  return meaningfulChildren.length === 1 && meaningfulChildren[0]?.type === 'element' && meaningfulChildren[0].tagName === 'img';
}

function isPlainTextEmphasis(node: any): boolean {
  if (node?.type !== 'element' || node.tagName !== 'em' || !Array.isArray(node.children)) {
    return false;
  }

  return node.children.length > 0 && node.children.every((child: any) => child.type === 'text');
}

function takeCalloutType(paragraph: any): string | null {
  if (paragraph?.type !== 'element' || paragraph.tagName !== 'p' || !Array.isArray(paragraph.children)) {
    return null;
  }

  for (let index = 0; index < paragraph.children.length; index += 1) {
    const child = paragraph.children[index];

    if (isWhitespaceText(child)) {
      continue;
    }

    if (child?.type !== 'text') {
      return null;
    }

    const value = String(child.value ?? '');
    const marker = CALLOUT_MARKER_PATTERN.exec(value);

    if (!marker) {
      return null;
    }

    const calloutType = marker[1].toLowerCase();

    if (!CALLOUT_TYPES.has(calloutType)) {
      return null;
    }

    child.value = value.slice(marker[0].length);
    paragraph.children.splice(0, index);

    if (isWhitespaceText(paragraph.children[0])) {
      paragraph.children.shift();
    }

    return calloutType;
  }

  return null;
}

function rehypeTransformCallouts() {
  return (tree: any) => {
    visitTree(tree, (node) => {
      if (node?.type !== 'element' || node.tagName !== 'blockquote' || !Array.isArray(node.children)) {
        return;
      }

      const firstContentIndex = node.children.findIndex((child: any) => !isWhitespaceText(child));

      if (firstContentIndex === -1) {
        return;
      }

      const firstContent = node.children[firstContentIndex];

      if (firstContent?.type !== 'element' || firstContent.tagName !== 'p') {
        return;
      }

      const calloutType = takeCalloutType(firstContent);

      if (!calloutType) {
        return;
      }

      appendClassName(node, 'sc-callout');
      appendClassName(node, `sc-callout-${calloutType}`);

      if (isEmptyElement(firstContent)) {
        node.children.splice(firstContentIndex, 1);
      }
    });
  };
}

function isItalicOnlyParagraph(node: any): boolean {
  if (node?.type !== 'element' || node.tagName !== 'p' || !Array.isArray(node.children)) {
    return false;
  }

  const meaningfulChildren = node.children.filter((child: any) => !isWhitespaceText(child));
  return meaningfulChildren.length === 1 && isPlainTextEmphasis(meaningfulChildren[0]);
}

function rehypeMarkImageCaptions() {
  return (tree: any) => {
    visitTree(tree, (node) => {
      if (!Array.isArray(node.children)) {
        return;
      }

      for (let index = 0; index < node.children.length - 1; index += 1) {
        const current = node.children[index];
        const next = node.children[index + 1];

        if (isImageOnlyParagraph(current) && isItalicOnlyParagraph(next)) {
          appendClassName(current, 'sc-prose-image-paragraph');
          appendClassName(next, 'sc-prose-image-caption');
        }
      }
    });
  };
}

function rehypeWrapTables() {
  return (tree: any) => {
    visitTree(tree, (node) => {
      if (!Array.isArray(node.children)) {
        return;
      }

      const className = node.properties?.className;
      const classes = Array.isArray(className) ? className : typeof className === 'string' ? className.split(/\s+/) : [];

      if (classes.includes('sc-table-scroll')) {
        return;
      }

      node.children = node.children.map((child: any) => {
        if (child?.type === 'element' && child.tagName === 'table') {
          return {
            type: 'element',
            tagName: 'div',
            properties: {
              className: ['sc-table-scroll']
            },
            children: [child]
          };
        }

        return child;
      });
    });
  };
}

function rehypeAddHeadingIds(headings: MarkdownHeading[]) {
  return (tree: any) => {
    const slugger = createSlugger();

    visitTree(tree, (node) => {
      if (node.type !== 'element' || (node.tagName !== 'h2' && node.tagName !== 'h3')) {
        return;
      }

      const text = getNodeText(node).trim();

      if (!text) {
        return;
      }

      node.properties = node.properties ?? {};
      const existingId = typeof node.properties.id === 'string' ? node.properties.id : '';
      const slug = existingId || slugger(text);
      node.properties.id = slug;
      headings.push({
        depth: node.tagName === 'h2' ? 2 : 3,
        text,
        slug
      });
    });
  };
}

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: Array.from(
    new Set([
      ...(defaultSchema.tagNames ?? []),
      'del',
      'input',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td'
    ])
  ),
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), 'href', 'title', 'rel'],
    code: [...(defaultSchema.attributes?.code ?? []), 'className'],
    img: [...(defaultSchema.attributes?.img ?? []), 'src', 'alt', 'title', 'loading'],
    blockquote: [
      ...(defaultSchema.attributes?.blockquote ?? []),
      [
        'className',
        'sc-callout',
        'sc-callout-note',
        'sc-callout-tip',
        'sc-callout-important',
        'sc-callout-warning',
        'sc-callout-caution',
        'sc-callout-quote'
      ]
    ],
    h2: [...(defaultSchema.attributes?.h2 ?? []), 'id'],
    h3: [...(defaultSchema.attributes?.h3 ?? []), 'id'],
    input: [
      ['type', 'checkbox'],
      'checked',
      'disabled'
    ],
    li: [...(defaultSchema.attributes?.li ?? []), ['className', 'task-list-item']],
    ul: [...(defaultSchema.attributes?.ul ?? []), ['className', 'contains-task-list']]
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https']
  }
};

function createMarkdownProcessor(headings: MarkdownHeading[]) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkEscapeRawHtml)
    .use(remarkRehype)
    .use(rehypeTransformCallouts)
    .use(rehypeRewriteAssetImages)
    .use(rehypeAddHeadingIds, headings)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeHardenLinksAndImages)
    .use(rehypeMarkImageCaptions)
    .use(rehypeWrapTables)
    .use(rehypeStringify);
}

export function renderMarkdownWithHeadings(markdown: string): { html: string; headings: MarkdownHeading[] } {
  const headings: MarkdownHeading[] = [];
  const html = String(createMarkdownProcessor(headings).processSync(markdown));
  return { html, headings };
}

export function renderMarkdown(markdown: string): string {
  return renderMarkdownWithHeadings(markdown).html;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '');
}

export function decodeHtmlEntities(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  const decodeOnce = (input: string) => input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hexValue: string) => {
      const codePoint = Number.parseInt(hexValue, 16);
      try {
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
      } catch {
        return _;
      }
    })
    .replace(/&#([0-9]+);/g, (_, decimalValue: string) => {
      const codePoint = Number.parseInt(decimalValue, 10);
      try {
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
      } catch {
        return _;
      }
    });

  return decodeOnce(decodeOnce(String(value)));
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function wrapTablesInHtml(html: string): string {
  return html.replace(/<table\b[\s\S]*?<\/table>/gi, (match, offset: number, source: string) => {
    const before = source.slice(Math.max(0, offset - 120), offset);

    if (/class=(["'])[^"']*\bsc-table-scroll\b/i.test(before)) {
      return match;
    }

    return `<div class="sc-table-scroll">${match}</div>`;
  });
}

export function addHeadingIdsToHtml(html: string): { html: string; headings: MarkdownHeading[] } {
  const headings: MarkdownHeading[] = [];
  const slugger = createSlugger();
  const nextHtml = html.replace(/<h([23])([^>]*)>([\s\S]*?)<\/h\1>/g, (match, depthValue: string, attrs: string, body: string) => {
    const depth = Number(depthValue) as 2 | 3;
    const text = decodeHtmlEntities(stripTags(body)).trim();

    if (!text) {
      return match;
    }

    const idMatch = /\sid=(["'])(.*?)\1/.exec(attrs);
    const slug = idMatch ? idMatch[2] : slugger(text);
    headings.push({ depth, text, slug });

    if (idMatch) {
      return match;
    }

    return `<h${depth}${attrs} id="${escapeHtmlAttribute(slug)}">${body}</h${depth}>`;
  });

  return { html: wrapTablesInHtml(nextHtml), headings };
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

    if (url.startsWith('/i/')) {
      const token = url.slice('/i/'.length).trim();
      return ASSET_TOKEN_PATTERN.test(token) ? `/i/${token}` : null;
    }

    if (isSafeImageUrl(url)) {
      return normalizeImageUrl(url);
    }
  }

  return null;
}

export function extractAssetTokens(markdown: string): string[] {
  const tokens = new Set<string>();
  const pattern = /!\[[^\]]*]\(\s*(?:asset:|\/i\/)([A-Za-z0-9_-]{24,64})\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markdown)) !== null) {
    tokens.add(match[1]);
  }

  return [...tokens];
}

export function calculateWordCount(markdown: string): number {
  const latinWords = markdown.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  const cjkChars = markdown.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return latinWords + cjkChars;
}

export function calculateReadingTimeMinutes(markdown: string): number {
  return Math.max(1, Math.ceil(calculateWordCount(markdown) / 300));
}
