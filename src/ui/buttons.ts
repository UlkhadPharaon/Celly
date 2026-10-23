export interface ButtonEntry {
  id: string;
  element: HTMLElement;
  onClick: () => void;
  rect: DOMRect | null;
  visible: boolean;
}

/**
 * Registry of gesture-clickable DOM rects.
 * Rects are cached and refreshed on layout changes, so the render loop never
 * forces a synchronous layout per button (see DECISIONS D-20).
 */
export class ButtonRegistry {
  private entries = new Map<string, ButtonEntry>();
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
    e.element.classList.remove('is-hover', 'is-pressed');
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
      const style = window.getComputedStyle(e.element);
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && e.element.offsetParent !== null;
      e.visible = visible;
      e.rect = visible ? e.element.getBoundingClientRect() : null;
    }
  }

  refreshAll(): void {
    this.refresh();
  }

  /** Topmost (last registered) visible button containing the point. */
  hitTest(x: number, y: number): string | null {
    const all = [...this.entries.values()];
    for (let i = all.length - 1; i >= 0; i--) {
      const e = all[i];
      if (!e.visible || !e.rect) continue;
      const r = e.rect;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return e.id;
    }
    return null;
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
