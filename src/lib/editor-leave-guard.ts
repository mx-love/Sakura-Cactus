export interface EditorLeaveGuard {
  setDirty(dirty: boolean): void;
  dispose(): void;
}

/** Keep the native navigation warning separate from browser-local autosaving. */
export function createEditorLeaveGuard(target: EventTarget): EditorLeaveGuard {
  let registered = false;
  let disposed = false;
  const warnBeforeLeaving = (event: Event) => {
    event.preventDefault();
    // Required by browsers which still use the legacy beforeunload contract.
    (event as BeforeUnloadEvent).returnValue = '';
  };

  function setDirty(dirty: boolean) {
    if (disposed || registered === dirty) return;
    if (dirty) target.addEventListener('beforeunload', warnBeforeLeaving);
    else target.removeEventListener('beforeunload', warnBeforeLeaving);
    registered = dirty;
  }

  return {
    setDirty,
    dispose() {
      setDirty(false);
      disposed = true;
    }
  };
}
