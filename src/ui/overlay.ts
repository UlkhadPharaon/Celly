import type { ButtonRegistry } from './buttons';
import { svgIcon, ICONS } from './dom';

export interface OverlayChip {
  id: string;
  label: string;
  color?: string;
  onClick: () => void;
}

export interface OverlayButton {
  id: string;
  label: string;
  icon?: keyof typeof ICONS;
  primary?: boolean;
  onClick: () => void;
}

export interface OverlaySection {
  title: string;
  items?: string[];
  body?: string;
}

export interface OverlayContent {
  eyebrow: string;
  title: string;
  accent: string;
  summary: string;
  sections: OverlaySection[];
  chipsLabel?: string;
  chips?: OverlayChip[];
  buttons?: OverlayButton[];
}

export interface Anchor {
  x: number;
  y: number;
}

const GAP = 54;
const MARGIN = 18;
const TOPBAR = 86;
const WIDTH = 384;

/**
 * Floating, hand-anchored info card used by both the lab and the knowledge graph.
 * Content is rebuilt on show; the shell keeps the element mounted so CSS transitions
 * can play in both directions.
 */
export class Overlay {
  readonly root: HTMLElement;
  private readonly inner: HTMLElement;
  private unregister: Array<() => void> = [];
  private anchor: Anchor | null = null;
  private open = false;
  private side: 'left' | 'right' = 'right';

  constructor(
    private readonly registry: ButtonRegistry,
    private readonly onClose: () => void
  ) {
    this.root = document.createElement('div');
    this.root.className = 'overlay-anchor';
    this.root.setAttribute('aria-live', 'polite');
    this.inner = document.createElement('article');
    this.inner.className = 'info-overlay';
    this.root.append(this.inner);
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(content: OverlayContent, anchor: Anchor | null): void {
    this.teardown();
    this.open = true;
    this.anchor = anchor;
    this.inner.style.setProperty('--accent', content.accent);
    this.inner.innerHTML = `
      <div class="overlay-glow"></div>
      <header class="overlay-head">
        <div>
          <span class="eyebrow">${escapeHtml(content.eyebrow)}</span>
          <h2>${escapeHtml(content.title)}</h2>
        </div>
        <button class="icon-btn overlay-close" type="button" aria-label="Close"></button>
      </header>
      <p class="overlay-summary">${escapeHtml(content.summary)}</p>
      <div class="overlay-sections">
        ${content.sections
          .map(
            (s, i) => `
          <section class="overlay-section">
            <h3><span class="overlay-index">${String(i + 1).padStart(2, '0')}</span>${escapeHtml(s.title)}</h3>
            ${
              s.items
                ? `<ul>${s.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
                : `<p>${escapeHtml(s.body ?? '')}</p>`
            }
          </section>`
          )
          .join('')}
      </div>
      ${
        content.chips && content.chips.length
          ? `<div class="overlay-chips-wrap">
               <span class="overlay-chips-label">${escapeHtml(content.chipsLabel ?? 'Related')}</span>
               <div class="overlay-chips">
                 ${content.chips
                   .map(
                     (c) =>
                       `<button class="chip" type="button" data-chip="${escapeHtml(c.id)}" style="--chip:${
                         c.color ?? content.accent
                       }">${escapeHtml(c.label)}</button>`
                   )
                   .join('')}
               </div>
             </div>`
          : ''
      }
      ${
        content.buttons && content.buttons.length
          ? `<footer class="overlay-actions">
               ${content.buttons
                 .map(
                   (b) => `<button class="btn ${b.primary ? 'primary' : 'ghost'}" type="button" data-action="${escapeHtml(
                     b.id
                   )}">
                     ${b.icon ? svgIcon(ICONS[b.icon]).outerHTML : ''}<span>${escapeHtml(b.label)}</span>
                   </button>`
                 )
                 .join('')}
             </footer>`
          : ''
      }
    `;

    const closeBtn = this.inner.querySelector('.overlay-close') as HTMLButtonElement;
    closeBtn.innerHTML = svgIcon(ICONS.close).outerHTML;
    closeBtn.addEventListener('click', () => this.onClose());
    this.unregister.push(this.registry.register('overlay:close', closeBtn, () => this.onClose()));

    for (const chip of content.chips ?? []) {
      const node = this.inner.querySelector(`[data-chip="${cssEscape(chip.id)}"]`) as HTMLButtonElement | null;
      if (!node) continue;
      node.addEventListener('click', chip.onClick);
      this.unregister.push(this.registry.register(`overlay:chip:${chip.id}`, node, chip.onClick));
    }
    for (const button of content.buttons ?? []) {
      const node = this.inner.querySelector(`[data-action="${cssEscape(button.id)}"]`) as HTMLButtonElement | null;
      if (!node) continue;
      node.addEventListener('click', button.onClick);
      this.unregister.push(this.registry.register(`overlay:${button.id}`, node, button.onClick));
    }

    this.root.classList.add('is-open');
    this.place();
    // The card grows in height after layout; place again once measured.
    requestAnimationFrame(() => this.place());
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('is-open');
    this.teardown();
    this.anchor = null;
  }

  update(anchor: Anchor | null): void {
    if (!this.open) return;
    this.anchor = anchor;
    this.place();
  }

  /** Screen box of the open card, so other floating UI can stay clear of it. */
  bounds(): DOMRect | null {
    return this.open ? this.root.getBoundingClientRect() : null;
  }

  private place(): void {
    if (!this.anchor) {
      this.root.style.left = `${Math.max(MARGIN, window.innerWidth - WIDTH - 44)}px`;
      this.root.style.top = '50%';
      this.root.style.transform = 'translateY(-50%)';
      return;
    }
    const h = this.inner.offsetHeight || 360;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Keep the card on the far side of the anchor, but stay out of the fixed HUD rail and the
    // control panel. On a centred node both sides fit; on a left-hand node only the right side
    // clears the rail, and vice versa near the control panel.
    const rail = document.querySelector('.left-rail')?.getBoundingClientRect();
    const controls = document.querySelector('.controls')?.getBoundingClientRect();
    const safeLeft = Math.max(MARGIN, rail && rail.width > 0 ? rail.right + 14 : MARGIN);
    const safeRight = Math.min(
      vw - MARGIN,
      controls && controls.width > 0 ? controls.left - 14 : vw - MARGIN
    );
    const leftCandidate = this.anchor.x - WIDTH - GAP;
    const rightCandidate = this.anchor.x + GAP;
    const leftFits = leftCandidate >= safeLeft;
    const rightFits = rightCandidate + WIDTH <= safeRight;
    // Prefer the open side of the scene: the left rail is wider than the control panel, and a card
    // that fits on the right never has to cover the legend.
    let preferRight = rightFits;
    if (!rightFits && !leftFits) preferRight = safeRight - this.anchor.x >= this.anchor.x - safeLeft;
    this.side = preferRight ? 'right' : 'left';
    let left = preferRight ? rightCandidate : leftCandidate;
    if (safeRight - WIDTH >= safeLeft) {
      left = Math.max(safeLeft, Math.min(safeRight - WIDTH, left));
    } else {
      left = Math.max(MARGIN, Math.min(vw - WIDTH - MARGIN, left));
    }
    let top = this.anchor.y - h * 0.35;
    top = Math.max(TOPBAR, Math.min(vh - h - MARGIN, top));
    this.root.style.left = `${Math.round(left)}px`;
    this.root.style.top = `${Math.round(top)}px`;
    this.root.style.transform = 'none';
    this.root.dataset.side = this.side;
  }

  private teardown(): void {
    for (const fn of this.unregister) fn();
    this.unregister = [];
  }

  destroy(): void {
    this.teardown();
    this.root.remove();
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
