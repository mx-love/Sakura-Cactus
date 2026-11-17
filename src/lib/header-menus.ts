const boundHeaders = new WeakSet<HTMLElement>();

function bindAccount(menu: HTMLDetailsElement): void {
  const toggle = menu.querySelector<HTMLElement>('[data-account-toggle]');
  const button = menu.querySelector<HTMLButtonElement>('[data-account-logout]');
  const status = menu.querySelector<HTMLElement>('[data-account-status]');
  if (!(toggle instanceof HTMLElement) || !(button instanceof HTMLButtonElement) || !(status instanceof HTMLElement)) return;

  const avatar = toggle.querySelector<HTMLImageElement>('[data-account-avatar]');
  const fallback = toggle.querySelector<HTMLElement>('[data-account-fallback]');
  if (avatar instanceof HTMLImageElement && fallback instanceof HTMLElement) {
    function showAvatar() {
      toggle!.classList.add('sc-account-avatar-ready');
    }

    function showFallback() {
      avatar!.hidden = true;
      fallback!.hidden = false;
      toggle!.classList.remove('sc-account-avatar-ready');
    }

    if (avatar.complete) {
      if (avatar.naturalWidth > 0) showAvatar();
      else showFallback();
    }
    avatar.addEventListener('load', showAvatar, { once: true });
    avatar.addEventListener('error', showFallback, { once: true });
  }

  let armed = false;
  let loggingOut = false;
  let timer = 0;

  function setStatus(message: string, error = false): void {
    status!.textContent = message;
    status!.hidden = !message;
    status!.dataset.state = error ? 'error' : 'idle';
  }

  function resetConfirmation(): void {
    armed = false;
    window.clearTimeout(timer);
    timer = 0;
    button!.classList.remove('sc-account-armed');
    if (!loggingOut) {
      button!.textContent = '退出登录';
      setStatus('');
    }
  }

  menu.addEventListener('toggle', () => {
    if (!menu.open) resetConfirmation();
  });
  window.addEventListener('pagehide', resetConfirmation);

  button.addEventListener('click', async () => {
    if (loggingOut) return;
    if (!armed) {
      armed = true;
      button.textContent = '确认退出';
      button.classList.add('sc-account-armed');
      setStatus('再次点击“确认退出”即可退出登录。');
      timer = window.setTimeout(resetConfirmation, 3000);
      return;
    }

    resetConfirmation();
    loggingOut = true;
    button.disabled = true;
    button.textContent = '正在退出……';
    setStatus('正在退出登录……');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Logout failed.');
      setStatus('已退出，正在返回首页。');
      window.location.assign('/');
    } catch {
      setStatus('退出失败，请稍后重试。', true);
    } finally {
      loggingOut = false;
      button.disabled = false;
      button.textContent = '退出登录';
    }
  });
}

export function bindHeaderMenus(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('.sc-site-header').forEach((header) => {
    if (boundHeaders.has(header)) return;
    boundHeaders.add(header);
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
      if (menu.hasAttribute('data-account-menu')) bindAccount(menu);
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
