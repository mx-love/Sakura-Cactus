async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.append(textarea);
  textarea.select();

  try {
    if (!document.execCommand('copy')) {
      throw new Error('Copy command failed.');
    }
  } finally {
    textarea.remove();
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgElement(name: string) {
  return document.createElementNS(SVG_NS, name);
}

function createPath(d: string) {
  const path = createSvgElement('path');
  path.setAttribute('d', d);
  return path;
}

function createCopyIcon() {
  const svg = createSvgElement('svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');

  const rect = createSvgElement('rect');
  rect.setAttribute('x', '8');
  rect.setAttribute('y', '8');
  rect.setAttribute('width', '10');
  rect.setAttribute('height', '10');
  rect.setAttribute('rx', '2');

  svg.append(rect, createPath('M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'));
  return svg;
}

function createCheckIcon() {
  const svg = createSvgElement('svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.append(createPath('m5 12 4 4L19 6'));
  return svg;
}

function setButtonState(button: HTMLButtonElement, state: 'idle' | 'success') {
  const icon = button.querySelector('.sc-code-copy-icon');
  const label = state === 'success' ? '已复制' : '复制代码';

  button.classList.toggle('sc-code-copy-success', state === 'success');
  button.setAttribute('aria-label', label);
  button.title = label;

  if (icon) {
    icon.replaceChildren(state === 'success' ? createCheckIcon() : createCopyIcon());
  }
}

function setTemporarySuccess(button: HTMLButtonElement) {
  setButtonState(button, 'success');
  window.setTimeout(() => {
    setButtonState(button, 'idle');
  }, 1400);
}

export function enhanceCodeBlocks(root: ParentNode = document): void {
  const codeBlocks = Array.from(root.querySelectorAll('pre > code'));

  for (const code of codeBlocks) {
    const pre = code.parentElement;

    if (!(pre instanceof HTMLPreElement)) {
      continue;
    }

    const existingWrapper = pre.parentElement;

    if (existingWrapper instanceof HTMLElement && existingWrapper.dataset.copyEnhanced === 'true') {
      continue;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'sc-code-block';
    wrapper.dataset.copyEnhanced = 'true';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sc-code-copy';
    button.setAttribute('aria-label', '复制代码');
    button.title = '复制代码';

    const icon = document.createElement('span');
    icon.className = 'sc-code-copy-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.append(createCopyIcon());
    button.append(icon);

    button.addEventListener('click', async () => {
      try {
        await copyText(code.textContent ?? '');
        setTemporarySuccess(button);
      } catch {
        setButtonState(button, 'idle');
      }
    });

    pre.before(wrapper);
    wrapper.append(pre, button);
  }
}
