import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

const ASSET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,64}$/;

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

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkEscapeRawHtml)
  .use(remarkRehype)
  .use(rehypeRewriteAssetImages)
  .use(rehypeSanitize, sanitizeSchema)
  .use(rehypeHardenLinksAndImages)
  .use(rehypeMarkImageCaptions)
  .use(rehypeStringify);

export function renderMarkdown(markdown: string): string {
  return String(markdownProcessor.processSync(markdown));
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

export function extractAssetTokens(markdown: string): string[] {
  const tokens = new Set<string>();
  const pattern = /!\[[^\]]*]\(\s*asset:([A-Za-z0-9_-]{24,64})\s*\)/g;
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
