const boundHeaders = new WeakSet<HTMLElement>();

function bindAccount(account: HTMLElement): void {
  const toggle = account.querySelector<HTMLButtonElement>('[data-account-toggle]');
  const status = account.querySelector<HTMLElement>('[data-account-status]');
  if (!(toggle instanceof HTMLButtonElement) || !(status instanceof HTMLElement)) return;

  const avatar = toggle.querySelector<HTMLImageElement>('[data-account-avatar]');
  const fallback = toggle.querySelector<HTMLElement>('[data-account-fallback]');
  if (avatar instanceof HTMLImageElement && fallback instanceof HTMLElement) {
    const showAvatar = () => toggle.classList.add('sc-account-avatar-ready');
    const showFallback = () => {
      avatar.hidden = true;
      fallback.hidden = false;
      toggle.classList.remove('sc-account-avatar-ready');
    };
    if (avatar.complete) {
      if (avatar.naturalWidth > 0) showAvatar();
      else showFallback();
    }
    avatar.addEventListener('load', showAvatar, { once: true });
    avatar.addEventListener('error', showFallback, { once: true });
  }

  let loggingOut = false;
  let lastTap = 0;
  let hintTimer = 0;

  function setStatus(message: string, error = false): void {
    window.clearTimeout(hintTimer);
    status!.textContent = message;
    status!.hidden = !message;
    status!.dataset.state = error ? 'error' : 'idle';
  }

  async function logout(): Promise<void> {
    if (loggingOut) return;
    loggingOut = true;
    toggle!.disabled = true;
    toggle!.classList.add('sc-account-leaving');
    setStatus('正在退出……');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Logout failed.');
      window.location.assign('/');
    } catch {
      setStatus('退出失败，请稍后重试', true);
      hintTimer = window.setTimeout(() => setStatus(''), 2400);
      loggingOut = false;
      toggle!.disabled = false;
      toggle!.classList.remove('sc-account-leaving');
    }
  }

  // Two taps within 400 ms log out. Counted by hand so touch screens behave like a mouse double click.
  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    const now = event.timeStamp;
    if (now - lastTap < 400) {
      lastTap = 0;
      void logout();
      return;
    }
    lastTap = now;
  });

  window.addEventListener('pagehide', () => setStatus(''));
}

export function bindHeaderMenus(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('.sc-site-header').forEach((header) => {
    if (boundHeaders.has(header)) return;
    boundHeaders.add(header);
    header.querySelectorAll<HTMLElement>('[data-account]').forEach(bindAccount);
    const menus = Array.from(header.querySelectorAll<HTMLDetailsElement>('[data-header-menu]'));

    function closeMenu(menu: HTMLDetailsElement, restoreFocus = false): void {
      if (!menu.open) return;
      menu.open = false;
      const toggle = menu.querySelector<HTMLElement>('[data-header-menu-toggle]');
      toggle?.setAttribute('aria-expanded', 'false');
      if (restoreFocus) toggle?.focus({ preventScroll: true });
    }

    for (const menu of menus) {
      const toggle = menu.querySelector<HTMLElement>('[data-header-menu-toggle]');
      if (!toggle) continue;

      menu.addEventListener('toggle', () => {
        toggle.setAttribute('aria-expanded', String(menu.open));
        if (menu.open) menus.forEach((other) => { if (other !== menu) closeMenu(other); });
      });

      toggle.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        menus.forEach((other) => { if (other !== menu) closeMenu(other); });
        menu.open = true;
        toggle.setAttribute('aria-expanded', 'true');
        const links = Array.from(menu.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)'));
        const target = event.key === 'ArrowUp' ? links.at(-1) : links[0];
        target?.focus({ preventScroll: true });
      });

      toggle.setAttribute('aria-expanded', String(menu.open));
    }

    document.addEventListener('click', (event) => {
      if (!(event.target instanceof Node)) return;
      for (const menu of menus) {
        const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
        if (!menu.contains(event.target) || (link && menu.contains(link))) closeMenu(menu);
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const openMenu = menus.find((menu) => menu.open);
      if (!openMenu) return;
      event.preventDefault();
      closeMenu(openMenu, true);
    });

    document.addEventListener('focusin', (event) => {
      if (!(event.target instanceof Node)) return;
      for (const menu of menus) {
        if (!menu.contains(event.target)) closeMenu(menu);
      }
    });

    window.addEventListener('pagehide', () => menus.forEach((menu) => closeMenu(menu)));
  });
}
