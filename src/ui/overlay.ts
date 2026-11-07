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
 * Layout probes (rail, control panel) only change on resize or when a panel toggles, so they
 * are re-measured on a coarse cadence instead of on every `place()` — a hand-anchored card runs
 * `update()` roughly 17 times a second while it is open.
 */
const PROBE_TTL_MS = 400;

/** Small read-only view of the elements the card has to dodge. */
interface Probe {
  left: number;
  right: number;
  width: number;
  top: number;
}

/** Everything `place()` derives; compared before writing so no-op frames write nothing. */
interface PlaceState {
  width: number;
  maxHeight: string;
  overflowY: string;
  left: number;
  top: number;
  transform: string;
  side: string;
}

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

  private rail: Probe | null = null;
  private controls: Probe | null = null;
  private probedAt = -Infinity;
  private cardHeight = 0;
  private placed: PlaceState | null = null;
  private boundsCache: DOMRect | null = null;
  private boundsDirty = true;

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
    window.addEventListener('resize', this.invalidateLayout, { passive: true });
  }

  /** Resize, panel toggles and content swaps all invalidate the cached layout and bounds. */
  private invalidateLayout = (): void => {
    this.probedAt = -Infinity;
    this.placed = null;
    this.cardHeight = 0;
    this.boundsCache = null;
    this.boundsDirty = true;
    if (this.open) this.place();
  };

  get isOpen(): boolean {
    return this.open;
  }

  show(content: OverlayContent, anchor: Anchor | null): void {
    this.teardown();
    this.open = true;
    this.anchor = anchor;
    // The content is rebuilt, so the card's size and its cached box are both unknown again.
    this.cardHeight = 0;
    this.placed = null;
    this.boundsCache = null;
    this.boundsDirty = true;
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
    this.boundsCache = null;
    this.boundsDirty = true;
  }

  update(anchor: Anchor | null): void {
    if (!this.open) return;
    // Hand motion moves the card, but sub-pixel jitter must not force a re-layout.
    const previous = this.anchor;
    this.anchor = anchor;
    if (
      anchor &&
      previous &&
      Math.abs(anchor.x - previous.x) < 0.5 &&
      Math.abs(anchor.y - previous.y) < 0.5 &&
      this.placed
    ) {
      return;
    }
    this.place();
  }

  /** Screen box of the open card, so other floating UI can stay clear of it. */
  bounds(): DOMRect | null {
    if (!this.open) return null;
    // The box only changes when the card is repositioned, resized or rebuilt, all of which
    // invalidate the cache — so this no longer costs a layout read per frame.
    if (this.boundsDirty || !this.boundsCache) {
      this.boundsCache = this.root.getBoundingClientRect();
      this.boundsDirty = false;
    }
    return this.boundsCache;
  }

  /** Re-measure the rail and control panel the card has to dodge, at most every `PROBE_TTL_MS`. */
  private probe(): void {
    const now = performance.now();
    if (now - this.probedAt < PROBE_TTL_MS) return;
    this.probedAt = now;
    const rail = document.querySelector('.left-rail')?.getBoundingClientRect();
    this.rail = rail ? { left: rail.left, right: rail.right, width: rail.width, top: rail.top } : null;
    const controls = document.querySelector('.controls')?.getBoundingClientRect();
    this.controls = controls
      ? { left: controls.left, right: controls.right, width: controls.width, top: controls.top }
      : null;
  }

  /** Write a style property only when it actually changes, so idle frames do zero DOM writes. */
  private write(el: HTMLElement, css: 'width' | 'left' | 'top' | 'transform' | 'max-height' | 'overflow-y', value: string): void {
    if (el.style.getPropertyValue(css) === value) return;
    el.style.setProperty(css, value);
  }

  private place(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = vw <= 640 ? 12 : MARGIN;
    const width = Math.min(WIDTH, vw - margin * 2);

    this.probe();

    const rail = this.rail;
    const controls = this.controls;
    // On phones and tablets the control panel is a full-width bottom sheet. Reserve the strip
    // above it rather than treating it as a right-hand column.
    const controlsIsSheet = !!controls && controls.width > vw * 0.45 && controls.top > vh * 0.32;
    const bottomReserve = controlsIsSheet
      ? Math.max(margin, vh - controls.top + 10)
      : margin;
    const compact = controlsIsSheet || vw <= 1080;
    const maxHeight = Math.max(200, vh - TOPBAR - bottomReserve - margin);

    // The card's own height is only re-measured when something that changes it has happened:
    // a rebuild, a resize, or a max-height change. Hand motion alone never changes it.
    const measured = Math.round(maxHeight);
    if (this.cardHeight === 0 || this.placed?.maxHeight !== `${measured}px`) {
      this.cardHeight = Math.min(this.inner.offsetHeight || 360, maxHeight);
    }

    if (!this.anchor) {
      const next: PlaceState = {
        width,
        maxHeight: compact ? `${measured}px` : '',
        overflowY: compact ? 'auto' : '',
        left: -1,
        top: -1,
        transform: compact ? 'none' : 'translateY(-50%)',
        side: 'right'
      };
      if (compact) {
        next.left = margin;
        next.top = TOPBAR;
      } else {
        next.left = Math.max(margin, vw - width - 44);
        next.top = -1;
      }
      this.placeState(next);
      return;
    }

    const h = Math.min(this.cardHeight || 360, maxHeight);
    // Keep the card on the far side of the anchor, but stay out of the fixed HUD rail and the
    // control panel. On a centred node both sides fit; on a left-hand node only the right side
    // clears the rail, and vice versa near the control panel.
    const safeLeft = Math.max(margin, rail && rail.width > 0 ? rail.right + 14 : margin);
    const safeRight = Math.min(
      vw - margin,
      controls && controls.width > 0 && !controlsIsSheet ? controls.left - 14 : vw - margin
    );
    const leftCandidate = this.anchor.x - width - GAP;
    const rightCandidate = this.anchor.x + GAP;
    const leftFits = leftCandidate >= safeLeft;
    const rightFits = rightCandidate + width <= safeRight;
    // Prefer the open side of the scene: the left rail is wider than the control panel, and a card
    // that fits on the right never has to cover the legend.
    let preferRight = rightFits;
    if (!rightFits && !leftFits) preferRight = safeRight - this.anchor.x >= this.anchor.x - safeLeft;
    this.side = preferRight ? 'right' : 'left';
    let left = preferRight ? rightCandidate : leftCandidate;
    if (safeRight - width >= safeLeft) {
      left = Math.max(safeLeft, Math.min(safeRight - width, left));
    } else {
      left = Math.max(margin, Math.min(vw - width - margin, left));
    }
    let top = this.anchor.y - h * 0.35;
    top = Math.max(TOPBAR, Math.min(vh - bottomReserve - h, top));
    this.placeState({
      width,
      maxHeight: compact ? `${measured}px` : '',
      overflowY: compact ? 'auto' : '',
      left: Math.round(left),
      top: Math.round(top),
      transform: 'none',
      side: this.side
    });
  }

  /** Apply a computed placement, skipping any write that would not change the element. */
  private placeState(next: PlaceState): void {
    const previous = this.placed;
    const moved =
      !previous ||
      previous.width !== next.width ||
      previous.left !== next.left ||
      previous.top !== next.top ||
      previous.transform !== next.transform ||
      previous.side !== next.side ||
      previous.maxHeight !== next.maxHeight ||
      previous.overflowY !== next.overflowY;

    this.write(this.root, 'width', `${next.width}px`);
    this.write(this.inner, 'max-height', next.maxHeight);
    this.write(this.inner, 'overflow-y', next.overflowY);
    this.write(this.root, 'transform', next.transform);
    if (next.left >= 0) this.write(this.root, 'left', `${next.left}px`);
    else this.write(this.root, 'left', '');
    if (next.top >= 0) this.write(this.root, 'top', `${next.top}px`);
    if (next.side !== this.root.dataset.side) this.root.dataset.side = next.side;
    this.placed = next;

    if (moved) {
      // Anything that moved the card invalidates its cached box.
      this.boundsCache = null;
      this.boundsDirty = true;
    }
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
