export interface ButtonEntry {
  id: string;
  element: HTMLElement;
  onClick: () => void;
  rect: DOMRect | null;
  visible: boolean;
  /** Resolved by `document.elementFromPoint`, not by a cached rect. */
  dynamic?: boolean;
}

/**
 * Native interactive elements the hand may activate even when nothing registered them
 * explicitly. A pinch is a click: every control the mouse can press, the hand can press.
 */
const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'summary',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="tab"]',
  '[role="link"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[data-celly-target]'
].join(',');

function isDisabled(element: HTMLElement): boolean {
  const control = element as HTMLButtonElement;
  return (
    control.disabled === true ||
    element.getAttribute('aria-disabled') === 'true' ||
    element.closest('[aria-disabled="true"]') !== null
  );
}

/**
 * Registry of gesture-clickable DOM rects.
 * Rects are cached and refreshed on layout changes, so the render loop never
 * forces a synchronous layout per button (see DECISIONS D-20).
 *
 * Anything interactive that was never registered still resolves through
 * `document.elementFromPoint`, so no control is mouse-only. That fallback is what makes the
 * help/test-panel buttons, native links and future markup reachable without remembering to
 * register each one.
 */
export class ButtonRegistry {
  private entries = new Map<string, ButtonEntry>();
  /** Element → dynamic entry id, so hover and click keep referring to the same node. */
  private readonly domIds = new WeakMap<HTMLElement, string>();
  private domSequence = 0;
  private hovered: string | null = null;
  private pressed: string | null = null;

  register(id: string, element: HTMLElement, onClick: () => void): () => void {
    this.entries.set(id, { id, element, onClick, rect: null, visible: true });
    this.refresh(id);
    return () => this.unregister(id);
  }

  unregister(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.element.classList.remove('is-hover', 'is-pressed', 'is-dwelling');
    this.entries.delete(id);
  }

  clear(): void {
    for (const id of [...this.entries.keys()]) this.unregister(id);
    this.hovered = null;
    this.pressed = null;
  }

  trigger(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    flash(e.element);
    e.onClick();
  }

  refresh(id?: string): void {
    const targets = id ? [this.entries.get(id)].filter(Boolean) : [...this.entries.values()];
    for (const e of targets as ButtonEntry[]) {
      // Dynamic entries have no cached rect: they are re-hit-tested every frame.
      if (e.dynamic) continue;
      const style = window.getComputedStyle(e.element);
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && e.element.offsetParent !== null;
      e.visible = visible;
      e.rect = visible ? e.element.getBoundingClientRect() : null;
    }
  }

  refreshAll(): void {
    this.refresh();
  }

  /** Topmost registered button, then any other native interactive element, containing the point. */
  hitTest(x: number, y: number): string | null {
    const all = [...this.entries.values()];
    for (let i = all.length - 1; i >= 0; i--) {
      const e = all[i];
      if (e.dynamic || !e.visible || !e.rect) continue;
      const r = e.rect;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return e.id;
    }
    const element = this.interactiveAt(x, y);
    return element ? this.ensureDomEntry(element) : null;
  }

  /**
   * The element the mouse would click at this point, walked up to its interactive ancestor.
   * `elementFromPoint` already ignores `pointer-events: none` layers (cursors, HUD chrome), so
   * the hand never clicks its own overlay.
   */
  private interactiveAt(x: number, y: number): HTMLElement | null {
    if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return null;
    const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!hit) return null;
    // `closest` only walks up, so a click on a child of a button resolves to the button.
    const target = hit.closest(INTERACTIVE_SELECTOR) as HTMLElement | null;
    if (!target || isDisabled(target)) return null;
    return target;
  }

  /** Stable pseudo-entry for an unregistered element, so hover/click share one identity. */
  private ensureDomEntry(element: HTMLElement): string {
    const known = this.domIds.get(element);
    if (known) {
      const entry = this.entries.get(known);
      if (entry) return known;
    }
    const id = `dom:${++this.domSequence}`;
    this.domIds.set(element, id);
    this.entries.set(id, {
      id,
      element,
      // `click()` runs every listener the mouse path runs, including ones added after the
      // registry snapshot and native link navigation.
      onClick: () => element.click(),
      rect: null,
      visible: true,
      dynamic: true
    });
    // Entries for elements that scrolled out of existence must not accumulate for a whole session.
    if (this.domSequence % 32 === 0) this.pruneDomEntries();
    return id;
  }

  private pruneDomEntries(): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.dynamic && !entry.element.isConnected) {
        entry.element.classList.remove('is-hover', 'is-pressed', 'is-dwelling');
        this.entries.delete(entry.id);
      }
    }
  }

  setHover(id: string | null): void {
    if (this.hovered === id) return;
    if (this.hovered) this.entries.get(this.hovered)?.element.classList.remove('is-hover');
    this.hovered = id;
    if (id) this.entries.get(id)?.element.classList.add('is-hover');
  }

  setPressed(id: string | null): void {
    if (this.pressed === id) return;
    if (this.pressed) this.entries.get(this.pressed)?.element.classList.remove('is-pressed');
    this.pressed = id;
    if (id) this.entries.get(id)?.element.classList.add('is-pressed');
  }

  setDwell(id: string | null, progress: number): void {
    for (const e of this.entries.values()) {
      if (e.id === id && progress > 0) {
        e.element.style.setProperty('--dwell', String(Math.min(1, progress)));
        e.element.classList.add('is-dwelling');
      } else {
        e.element.classList.remove('is-dwelling');
        e.element.style.removeProperty('--dwell');
      }
    }
  }

  get hoveredId(): string | null {
    return this.hovered;
  }

  get count(): number {
    return this.entries.size;
  }
}

function flash(element: HTMLElement): void {
  element.classList.remove('is-flash');
  // Force reflow so the animation can restart.
  void element.offsetWidth;
  element.classList.add('is-flash');
  window.setTimeout(() => element.classList.remove('is-flash'), 420);
}
