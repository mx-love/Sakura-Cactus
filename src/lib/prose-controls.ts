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

  if (state === 'success') {
    button.dataset.copied = 'true';
  } else {
    delete button.dataset.copied;
  }

  if (icon) {
    icon.replaceChildren(state === 'success' ? createCheckIcon() : createCopyIcon());
  }
}

const resetTimers = new WeakMap<HTMLButtonElement, number>();
const boundCodeCopyRoots = new WeakSet<EventTarget>();

function setTemporarySuccess(button: HTMLButtonElement) {
  setButtonState(button, 'success');

  const existingTimer = resetTimers.get(button);

  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  const timer = window.setTimeout(() => {
    setButtonState(button, 'idle');
    resetTimers.delete(button);
  }, 1400);

  resetTimers.set(button, timer);
}

async function handleCodeCopyClick(event: Event) {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest('.sc-code-copy');

  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const wrapper = button.closest('.sc-code-block');
  const code = wrapper?.querySelector('pre > code');

  if (!code) {
    return;
  }

  try {
    await copyText(code.textContent ?? '');
    setTemporarySuccess(button);
  } catch {
    setButtonState(button, 'idle');
  }
}

export function bindCodeCopyControls(root: (ParentNode & EventTarget) = document): void {
  if (boundCodeCopyRoots.has(root)) {
    return;
  }

  root.addEventListener('click', handleCodeCopyClick);
  boundCodeCopyRoots.add(root);
}
