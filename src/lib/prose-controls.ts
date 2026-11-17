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

function setButtonState(button: HTMLButtonElement, state: 'idle' | 'success' | 'error') {
  const icon = button.querySelector('.sc-code-copy-icon');
  const label = state === 'error' ? '复制失败，请手动选择代码复制' : state === 'success' ? '已复制' : '复制代码';

  button.classList.toggle('sc-code-copy-success', state === 'success');
  button.classList.toggle('sc-code-copy-error', state === 'error');
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);

  const wrapper = button.closest('.sc-code-block');
  let feedback = wrapper?.querySelector<HTMLElement>('.sc-code-copy-feedback');
  if (!feedback && wrapper) {
    feedback = document.createElement('span');
    feedback.className = 'sc-code-copy-feedback';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    wrapper.append(feedback);
  }
  if (feedback) feedback.textContent = state === 'idle' ? '' : state === 'success' ? '已复制' : '复制失败，请手动复制';

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

function setTemporaryState(button: HTMLButtonElement, state: 'success' | 'error') {
  setButtonState(button, state);

  const existingTimer = resetTimers.get(button);

  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  const timer = window.setTimeout(() => {
    setButtonState(button, 'idle');
    resetTimers.delete(button);
  }, state === 'error' ? 3500 : 1400);

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

  if (button.disabled) return;
  button.disabled = true;
  try {
    await copyText(code.textContent ?? '');
    setTemporaryState(button, 'success');
  } catch {
    setTemporaryState(button, 'error');
  } finally {
    button.disabled = false;
  }
}

export function bindCodeCopyControls(root: (ParentNode & EventTarget) = document): void {
  if (boundCodeCopyRoots.has(root)) {
    return;
  }

  root.addEventListener('click', handleCodeCopyClick);
  boundCodeCopyRoots.add(root);
}
