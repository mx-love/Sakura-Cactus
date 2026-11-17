interface DialogFocusOptions {
  initialFocus?: HTMLElement | null;
  onEscape?: () => void;
}

const FOCUSABLE_SELECTOR = 'a[href], button, input, select, textarea, summary, [tabindex]';
let activeDialog: { close: () => void; getReturnFocus: () => HTMLElement | null } | null = null;

export function createDialogFocus(container: HTMLElement, options: DialogFocusOptions = {}) {
  let active = false;
  let returnFocus: HTMLElement | null = null;
  let addedTabIndex = false;
  const dialog = {
    close() {
      deactivate({ restoreFocus: false });
      options.onEscape?.();
    },
    getReturnFocus: () => returnFocus
  };

  function getFocusableElements(): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
      return element.tabIndex >= 0
        && !element.matches(':disabled')
        && !element.closest('[hidden], [inert]')
        && element.getClientRects().length > 0;
    });
  }

  function focusFirst() {
    const target = options.initialFocus?.isConnected && !options.initialFocus.closest('[hidden], [inert]')
      ? options.initialFocus
      : getFocusableElements()[0] ?? container;
    target.focus({ preventScroll: true });
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && options.onEscape) {
      event.preventDefault();
      event.stopPropagation();
      options.onEscape();
      return;
    }

    if (event.key !== 'Tab') return;
    const focusable = getFocusableElements();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (!first || !last) {
      event.preventDefault();
      container.focus({ preventScroll: true });
      return;
    }

    const current = document.activeElement;
    if (event.shiftKey && (current === first || !focusable.includes(current as HTMLElement))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (current === last || !focusable.includes(current as HTMLElement))) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function handleFocusIn(event: FocusEvent) {
    if (event.target instanceof Node && !container.contains(event.target)) {
      focusFirst();
    }
  }

  function activate(trigger?: HTMLElement | null) {
    if (active) return;
    const previousTrigger = activeDialog?.getReturnFocus() ?? null;
    activeDialog?.close();
    active = true;
    activeDialog = dialog;
    const visibleTrigger = trigger?.isConnected && !trigger.closest('[hidden], [inert]') && trigger.getClientRects().length > 0 ? trigger : null;
    returnFocus = visibleTrigger ?? previousTrigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    addedTabIndex = !container.hasAttribute('tabindex');
    if (addedTabIndex) container.tabIndex = -1;
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', handleFocusIn);
    focusFirst();
  }

  function deactivate({ restoreFocus = true } = {}) {
    if (!active) return;
    active = false;
    if (activeDialog === dialog) activeDialog = null;
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('focusin', handleFocusIn);
    if (addedTabIndex) container.removeAttribute('tabindex');
    if (restoreFocus && returnFocus?.isConnected && !returnFocus.closest('[hidden], [inert]') && returnFocus.getClientRects().length > 0) {
      returnFocus.focus({ preventScroll: true });
    }
    returnFocus = null;
  }

  return { activate, deactivate };
}
