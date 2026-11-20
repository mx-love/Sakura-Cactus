import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEditorLeaveGuard } from '../src/lib/editor-leave-guard.ts';
import { getCodeLanguageLabel } from '../src/lib/code-language.ts';

class TrackingTarget extends EventTarget {
  added = 0;
  removed = 0;

  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    if (type === 'beforeunload') this.added += 1;
    super.addEventListener(type, listener, options);
  }

  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
    if (type === 'beforeunload') this.removed += 1;
    super.removeEventListener(type, listener, options);
  }

  leavingIsBlocked() {
    const event = new Event('beforeunload', { cancelable: true });
    // Node's generic Event has a read-only boolean returnValue; browsers use
    // a writable string on the specialized BeforeUnloadEvent instead.
    Object.defineProperty(event, 'returnValue', { value: '', writable: true });
    this.dispatchEvent(event);
    return event.defaultPrevented;
  }
}

test('an untouched editor adds no listener; edits warn until reverted or accepted', () => {
  const target = new TrackingTarget();
  const guard = createEditorLeaveGuard(target);
  guard.setDirty(false);
  assert.equal(target.added, 0);
  assert.equal(target.leavingIsBlocked(), false);

  guard.setDirty(true);
  guard.setDirty(true);
  assert.equal(target.added, 1, 'Repeated dirty renders must not duplicate the listener.');
  assert.equal(target.leavingIsBlocked(), true);

  // A browser-local autosave is not an acknowledgement of a published edit.
  assert.equal(target.leavingIsBlocked(), true);
  guard.setDirty(false);
  assert.equal(target.removed, 1);
  assert.equal(target.leavingIsBlocked(), false);

  guard.setDirty(true);
  assert.equal(target.leavingIsBlocked(), true);
  guard.setDirty(false); // Publish/discard must clear before navigating, not in an effect later.
  assert.equal(target.leavingIsBlocked(), false);
  guard.dispose();
});

test('unmount removes the active listener and a disposed guard cannot reactivate', () => {
  const target = new TrackingTarget();
  const guard = createEditorLeaveGuard(target);
  guard.setDirty(true);
  guard.dispose();
  guard.dispose();
  guard.setDirty(true);
  assert.equal(target.added, 1);
  assert.equal(target.removed, 1);
  assert.equal(target.leavingIsBlocked(), false);
});

test('language labels use common names and omit missing language classes', () => {
  for (const [language, expected] of Object.entries({
    js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript',
    sh: 'Shell', bash: 'Shell', zsh: 'Shell', py: 'Python', yml: 'YAML', md: 'Markdown',
    css: 'CSS', html: 'HTML', json: 'JSON', sql: 'SQL', cpp: 'C++', csharp: 'C#'
  })) {
    assert.equal(getCodeLanguageLabel(['other', `language-${language}`]), expected);
  }
  assert.equal(getCodeLanguageLabel(['language-TS']), 'TypeScript');
  assert.equal(getCodeLanguageLabel(['language-custom-language']), 'custom-language');
  assert.equal(getCodeLanguageLabel(['language-__proto__']), '__proto__');
  assert.equal(getCodeLanguageLabel(['language-constructor']), 'constructor');
  assert.equal(getCodeLanguageLabel(['language-toString']), 'toString');
  assert.equal(getCodeLanguageLabel(['other', 'language-']), null);
  assert.equal(getCodeLanguageLabel([]), null);
  // The caller inserts this as textContent, never as markup.
  assert.equal(getCodeLanguageLabel(['language-<img>']), '<img>');
});
