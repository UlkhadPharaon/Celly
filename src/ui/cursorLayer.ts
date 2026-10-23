import type { GestureFrame, HandSide } from '../types';

interface CursorNode {
  el: HTMLElement;
  ring: HTMLElement;
  label: HTMLElement;
  side: HandSide;
  mode: string;
  visible: boolean;
}

/** Screen-space pinch cursors + contextual gesture hint. */
export class CursorLayer {
  readonly root: HTMLElement;
  private readonly nodes = new Map<HandSide, CursorNode>();
  private readonly hint: HTMLElement;
  private hintText = '';

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'cursor-layer';
    this.root.setAttribute('aria-hidden', 'true');

    for (const side of ['left', 'right'] as const) {
      const el = document.createElement('div');
      el.className = 'cursor';
      el.dataset.side = side;
      el.innerHTML = `
        <div class="cursor-halo"></div>
        <div class="cursor-ring"><i></i></div>
        <div class="cursor-dot"></div>
        <div class="cursor-tag">${side === 'left' ? 'L' : 'R'}</div>
      `;
      this.root.append(el);
      this.nodes.set(side, {
        el,
        ring: el.querySelector('.cursor-ring') as HTMLElement,
        label: el.querySelector('.cursor-tag') as HTMLElement,
        side,
        mode: 'pointer',
        visible: false
      });
    }

    this.hint = document.createElement('div');
    this.hint.className = 'gesture-hint';
    this.root.append(this.hint);
  }

  update(
    cursors: GestureFrame['cursors'],
    hint: string,
    dwell = 0,
    hoverLabel = '',
    avoid: DOMRect | null = null
  ): void {
    for (const side of ['left', 'right'] as const) {
      const node = this.nodes.get(side);
      const state = cursors.find((c) => c.side === side);
      if (!node) continue;
      if (!state || !state.visible) {
        if (node.visible) {
          node.el.classList.remove('is-visible');
          node.el.classList.remove('is-active');
        }
        node.visible = false;
        continue;
      }
      node.visible = true;
      node.el.classList.add('is-visible');
      node.el.style.transform = `translate3d(${Math.round(state.x)}px, ${Math.round(state.y)}px, 0)`;
      if (state.mode !== node.mode) {
        node.mode = state.mode;
        node.el.dataset.mode = state.mode;
      }
      node.el.classList.toggle('is-active', state.active);
      node.el.classList.toggle('is-pinching', state.mode === 'pinch');
      node.ring.style.setProperty('--pinch', state.pinchValue.toFixed(3));
      node.el.style.setProperty('--dwell', dwell.toFixed(3));
      node.el.classList.toggle('is-dwelling', dwell > 0.01);

      const tag = state.mode === 'passive' ? `${side === 'left' ? 'L' : 'R'} · idle` : side === 'left' ? 'L' : 'R';
      if (node.label.textContent !== tag) node.label.textContent = tag;
    }

    const active = cursors.find((c) => c.active);
    const text = !active ? '' : hint ? (hoverLabel ? `${hint} · ${hoverLabel}` : hint) : hoverLabel;
    if (text !== this.hintText) {
      this.hintText = text;
      this.hint.textContent = text;
    }
    if (!active || !text) {
      this.hint.classList.remove('is-visible');
      return;
    }

    let x = active.x + 26;
    let y = active.y + 22;
    if (avoid) {
      const w = this.hint.offsetWidth || 180;
      const h = this.hint.offsetHeight || 30;
      const hit =
        x < avoid.right + 8 && x + w > avoid.left - 8 && y < avoid.bottom + 8 && y + h > avoid.top - 8;
      if (hit) {
        if (avoid.bottom + 10 + h < window.innerHeight - 8) y = avoid.bottom + 10;
        else if (avoid.top - 10 - h > 80) y = avoid.top - 10 - h;
        else x = Math.max(12, avoid.left - w - 10);
      }
    }
    this.hint.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    this.hint.classList.add('is-visible');
  }

  destroy(): void {
    this.root.remove();
  }
}
