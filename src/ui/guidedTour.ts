/**
 * The immersive guided tour: a lit region over one part of the interface at a time, with a card
 * that explains what that part is for and how to drive it in the participant's mode.
 *
 * It is deliberately an overlay of the real interface rather than a separate tutorial page — the
 * participant learns where things are by being shown the thing itself. Steps whose anchor is not
 * in the DOM are skipped, so one list serves every page and the text-only surface.
 */

import type { ButtonRegistry } from './buttons';
import type { Language } from '../types';
import type { InteractionMode } from '../study/types';
import { copyFor, tourStepsFor } from '../study/tourSteps';
import { escapeHtml } from './dom';

export const TOUR_COPY = {
  en: {
    kicker: 'Guided tour',
    next: 'Next',
    back: 'Back',
    skip: 'Skip',
    finish: 'Start',
    region: (i: number, n: number) => `Step ${i} of ${n}`,
    tryIt: 'Try it'
  },
  fr: {
    kicker: 'Visite guidée',
    next: 'Suivant',
    back: 'Retour',
    skip: 'Passer',
    finish: 'Commencer',
    region: (i: number, n: number) => `Étape ${i} sur ${n}`,
    tryIt: 'Essayez'
  }
} as const;

export interface GuidedTourOptions {
  /** Called with true when the tour ran to the end, false when it was skipped or closed. */
  onFinish: (completed: boolean) => void;
}

export class GuidedTour {
  readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly spot: HTMLElement;
  /**
   * Four strips around the lit region. A box-shadow can dim the rest of the screen but cannot
   * stop a click; these strips do, so the only live control during a step is the one being
   * explained (the participant can pinch it straight away).
   */
  private readonly shades: HTMLElement[];
  private language: Language = 'en';
  private mode: InteractionMode = 'hands';
  private steps: Array<ReturnType<typeof tourStepsFor>[number]> = [];
  private index = 0;
  private raf = 0;
  private unregister: Array<() => void> = [];

  constructor(
    private readonly registry: ButtonRegistry,
    private readonly opts: GuidedTourOptions
  ) {
    this.root = document.createElement('div');
    this.root.className = 'tour';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'celly-tour-title');

    this.spot = document.createElement('div');
    this.spot.className = 'tour-spot';

    this.shades = Array.from({ length: 4 }, () => {
      const shade = document.createElement('div');
      shade.className = 'tour-shade';
      return shade;
    });

    this.card = document.createElement('div');
    this.card.className = 'tour-card';

    this.root.append(...this.shades, this.spot, this.card);

    document.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.layout);
    window.addEventListener('scroll', this.layout, true);
  }

  get isOpen(): boolean {
    return this.root.classList.contains('is-open');
  }

  /** Resolve the steps against the DOM that exists right now, then open on the first one. */
  start(mode: InteractionMode, language: Language): void {
    this.mode = mode;
    this.language = language;
    this.steps = tourStepsFor(mode).filter((step) => this.isReachable(step));
    if (this.steps.length === 0) {
      this.opts.onFinish(false);
      return;
    }
    this.index = 0;
    this.root.classList.add('is-open');
    this.render();
    this.layout();
    this.raf = requestAnimationFrame(this.pump);
  }

  /**
   * A step survives only if its region is actually on screen and this mode has copy for it.
   * `document.querySelector` alone is not enough: the text condition hides the whole 3D app with
   * `display: none`, and a child of a hidden subtree still matches the selector — so the tour
   * would spotlight an invisible element and the card would point at nothing.
   */
  private isReachable(step: ReturnType<typeof tourStepsFor>[number]): boolean {
    if (!copyFor(step, this.mode)) return false;
    if (!step.anchor) return true;
    const anchor = document.querySelector<HTMLElement>(step.anchor);
    if (!anchor) return false;
    // `offsetParent` is null for display:none; a fixed element reports null anyway, so fall back
    // to the client-rect check, which is false exactly when the element paints nothing.
    if (anchor.offsetParent !== null) return true;
    return anchor.getClientRects().length > 0;
  }

  close(completed = false): void {
    if (!this.isOpen) return;
    this.root.classList.remove('is-open');
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.teardown();
    this.opts.onFinish(completed);
  }

  setLanguage(language: Language): void {
    this.language = language;
    if (this.isOpen) this.render();
  }

  private teardown(): void {
    for (const fn of this.unregister) fn();
    this.unregister = [];
  }

  private get step(): NonNullable<ReturnType<typeof copyFor>> {
    const copy = copyFor(this.steps[this.index], this.mode);
    if (copy) return copy;
    // A step without copy for this mode is a content bug, not a runtime condition: fall back to
    // English shared copy so the tour never shows an empty card.
    const fallback = this.steps[this.index].all;
    return {
      title: fallback?.title ?? { en: '', fr: '' },
      body: fallback?.body ?? { en: '', fr: '' },
      action: fallback?.action
    };
  }

  private render(): void {
    this.teardown();
    const ui = TOUR_COPY[this.language];
    const copy = this.step;
    const last = this.index === this.steps.length - 1;
    const loc = (value: { en: string; fr?: string }): string =>
      this.language === 'fr' ? (value.fr ?? value.en) : value.en;

    this.card.innerHTML = `
      <div class="tour-card-head">
        <span class="eyebrow">${ui.kicker}</span>
        <span class="tour-count">${escapeHtml(ui.region(this.index + 1, this.steps.length))}</span>
      </div>
      <h2 id="celly-tour-title">${escapeHtml(loc(copy.title))}</h2>
      <p class="tour-body">${escapeHtml(loc(copy.body))}</p>
      ${copy.action ? `<p class="tour-try"><b>${ui.tryIt}</b> ${escapeHtml(loc(copy.action))}</p>` : ''}
      <div class="tour-progress" aria-hidden="true">
        ${this.steps.map((_, i) => `<i class="${i === this.index ? 'is-on' : ''} ${i < this.index ? 'is-done' : ''}"></i>`).join('')}
      </div>
      <div class="tour-actions">
        <button class="btn ghost small" type="button" data-tour="skip">${ui.skip}</button>
        <span class="tour-spacer"></span>
        <button class="btn ghost" type="button" data-tour="back" ${this.index === 0 ? 'disabled' : ''}>${ui.back}</button>
        <button class="btn primary" type="button" data-tour="next">${last ? ui.finish : ui.next}</button>
      </div>
    `;

    const handlers: Record<string, () => void> = {
      skip: () => this.close(false),
      back: () => {
        if (this.index === 0) return;
        this.index -= 1;
        this.render();
        this.layout();
      },
      next: () => {
        if (last) {
          this.close(true);
          return;
        }
        this.index = Math.min(this.steps.length - 1, this.index + 1);
        this.render();
        this.layout();
      }
    };

    for (const btn of this.card.querySelectorAll<HTMLButtonElement>('[data-tour]')) {
      const handler = handlers[btn.dataset.tour as string];
      if (!handler) continue;
      btn.addEventListener('click', handler);
      this.unregister.push(this.registry.register(`tour:${btn.dataset.tour as string}`, btn, handler));
    }
    requestAnimationFrame(() => {
      this.card.querySelector<HTMLElement>('[data-tour="next"]')?.focus();
      this.registry.refreshAll();
    });
  }

  /** Keep the lit rectangle and the card glued to the anchor while the page moves under them. */
  private pump = (): void => {
    if (!this.isOpen) return;
    this.layout();
    this.raf = requestAnimationFrame(this.pump);
  };

  private layout = (): void => {
    if (!this.isOpen) return;
    const step = this.steps[this.index];
    const anchor = step.anchor ? document.querySelector<HTMLElement>(step.anchor) : null;
    if (!anchor) {
      // No anchor: a centred card (welcome / closing step). A single full-screen shade keeps the
      // tour modal, since there is no lit region to leave clickable.
      this.spot.style.opacity = '0';
      this.place(this.shades[0], 0, 0, window.innerWidth, window.innerHeight);
      for (const shade of this.shades.slice(1)) shade.style.display = 'none';
      this.card.classList.add('is-centred');
      this.card.classList.remove('is-below', 'is-above');
      this.card.style.removeProperty('--tour-x');
      this.card.style.removeProperty('--tour-y');
      return;
    }
    this.card.classList.remove('is-centred');
    const rect = anchor.getBoundingClientRect();
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(4, rect.left - pad);
    const spotTop = Math.max(4, rect.top - pad);
    const right = Math.min(vw - 4, rect.right + pad);
    const bottom = Math.min(vh - 4, rect.bottom + pad);

    this.spot.style.opacity = '1';
    this.spot.style.left = `${left}px`;
    this.spot.style.top = `${spotTop}px`;
    this.spot.style.width = `${right - left}px`;
    this.spot.style.height = `${bottom - spotTop}px`;

    // top, bottom, left, right — together they leave exactly the lit rectangle uncovered.
    const [shadeTop, shadeBottom, shadeLeft, shadeRight] = this.shades;
    this.place(shadeTop, 0, 0, vw, spotTop);
    this.place(shadeBottom, 0, bottom, vw, Math.max(0, vh - bottom));
    this.place(shadeLeft, 0, spotTop, left, Math.max(0, bottom - spotTop));
    this.place(shadeRight, right, spotTop, Math.max(0, vw - right), Math.max(0, bottom - spotTop));

    // Card placement: below the region when there is room, above otherwise, centred as a last
    // resort. The measurements are in viewport coordinates because the tour is fixed.
    const margin = 16;
    const cardHeight = this.card.offsetHeight || 260;
    const cardWidth = Math.min(420, window.innerWidth - margin * 2);
    const below = rect.bottom + 18;
    const above = rect.top - cardHeight - 18;
    const placeBelow = below + cardHeight < window.innerHeight - margin || above < margin;
    const top = placeBelow ? below : Math.max(margin, above);
    this.card.classList.toggle('is-below', placeBelow);
    this.card.classList.toggle('is-above', !placeBelow);
    this.card.style.setProperty('--tour-x', `${margin + Math.min(280, Math.max(0, rect.left))}px`);
    this.card.style.setProperty('--tour-y', `${Math.round(top)}px`);
    this.card.style.setProperty('--tour-w', `${cardWidth}px`);
  };

  private place(el: HTMLElement, x: number, y: number, width: number, height: number): void {
    el.style.display = width <= 0 || height <= 0 ? 'none' : 'block';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close(false);
      return;
    }
    if (event.key !== 'Tab') return;
    // Keyboard focus stays inside the card. The highlighted region stays clickable for a mouse
    // or a pinch, but the tour's own buttons are the only tab stops while it is open.
    const focusable = [...this.card.querySelectorAll<HTMLElement>('button:not([disabled])')];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
}