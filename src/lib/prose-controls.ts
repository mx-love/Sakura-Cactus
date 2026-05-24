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

function setTemporaryLabel(button: HTMLButtonElement, label: string) {
  button.textContent = label;
  window.setTimeout(() => {
    button.textContent = '复制';
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
    button.textContent = '复制';
    button.setAttribute('aria-label', '复制代码');

    button.addEventListener('click', async () => {
      try {
        await copyText(code.textContent ?? '');
        setTemporaryLabel(button, '已复制');
      } catch {
        setTemporaryLabel(button, '复制失败');
      }
    });

    pre.append(button);
  }
}
