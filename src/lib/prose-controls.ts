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

const COPY_ICON = `
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
    <rect x="8" y="8" width="10" height="10" rx="2"></rect>
    <path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>
`;
const CHECK_ICON = `
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
    <path d="m5 12 4 4L19 6"></path>
  </svg>
`;
const WARNING_ICON = `
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
    <path d="M12 9v4"></path>
    <path d="M12 17h.01"></path>
    <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"></path>
  </svg>
`;

function setButtonState(button: HTMLButtonElement, state: 'idle' | 'success' | 'error') {
  const icon = button.querySelector('.sc-code-copy-icon');
  const label = state === 'idle' ? '复制代码' : state === 'success' ? '已复制' : '复制失败';

  button.classList.toggle('sc-code-copy-success', state === 'success');
  button.classList.toggle('sc-code-copy-error', state === 'error');
  button.setAttribute('aria-label', label);
  button.title = label;

  if (icon) {
    icon.innerHTML = state === 'success' ? CHECK_ICON : state === 'error' ? WARNING_ICON : COPY_ICON;
  }
}

function setTemporaryState(button: HTMLButtonElement, state: 'success' | 'error') {
  setButtonState(button, state);
  window.setTimeout(() => {
    setButtonState(button, 'idle');
  }, 1400);
}

export function enhanceCodeBlocks(root: ParentNode = document): void {
  const codeBlocks = Array.from(root.querySelectorAll('pre > code'));

  for (const code of codeBlocks) {
    const pre = code.parentElement;

    if (!(pre instanceof HTMLPreElement) || pre.dataset.copyEnhanced === 'true') {
      continue;
    }

    pre.dataset.copyEnhanced = 'true';
    pre.classList.add('sc-code-block');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sc-code-copy';
    button.setAttribute('aria-label', '复制代码');
    button.title = '复制代码';
    button.innerHTML = `
      <span class="sc-code-copy-icon" aria-hidden="true">${COPY_ICON}</span>
    `;

    button.addEventListener('click', async () => {
      try {
        await copyText(code.textContent ?? '');
        setTemporaryState(button, 'success');
      } catch {
        setTemporaryState(button, 'error');
      }
    });

    pre.append(button);
  }
}
