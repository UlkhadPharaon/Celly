import type { Language } from '../types';
import { loadJSON } from '../core/store';

/**
 * Last line of defence against an uncaught failure (audit CELLY-CRIT-001). Renders a fixed
 * overlay above every other surface with the failing message, collapsible technical details
 * and two recovery actions: re-boot the app, or reload the page.
 *
 * The boundary must not depend on any other Celly module: it answers for the entire app,
 * including construction-time crashes of the app it sits next to. Only the pure localStorage
 * helper is imported, so the overlay can even report a failure thrown by an F12-level
 * `window.onerror` before the settings store exists. Copy language is read from the stored
 * settings, falling back to English.
 */

export interface ErrorBoundaryCopy {
  kicker: string;
  title: string;
  lead: string;
  retry: string;
  reload: string;
  detailSummary: string;
}

export const COPY: Record<Language, ErrorBoundaryCopy> = {
  en: {
    kicker: 'CELLY',
    title: 'Something went wrong',
    lead: 'The lab hit an internal error. You can re-launch it, or reload the whole page.',
    retry: 'Re-launch the lab',
    reload: 'Reload page',
    detailSummary: 'Technical details'
  },
  fr: {
    kicker: 'CELLY',
    title: 'Une erreur est survenue',
    lead: 'Le labo a rencontré une erreur interne. Vous pouvez le relancer, ou recharger la page.',
    retry: 'Relancer le labo',
    reload: 'Recharger la page',
    detailSummary: 'Détails techniques'
  }
};

export interface ErrorBoundaryOptions {
  /** Handler that disposes and rebuilds the app instance (see main.ts). */
  onRetry: () => void;
}

export class ErrorBoundary {
  readonly root: HTMLElement;
  private shown = false;

  private readonly title: HTMLElement;
  private readonly lead: HTMLElement;
  private readonly message: HTMLElement;
  private readonly detailText: HTMLElement;

  private readonly retryButton: HTMLButtonElement;
  private readonly reloadButton: HTMLButtonElement;

  constructor(private readonly opts: ErrorBoundaryOptions) {
    const copy: ErrorBoundaryCopy = this.copy();

    this.root = document.createElement('div');
    this.root.className = 'error-boundary';
    this.root.hidden = true;
    // role=alertdialog announces the failure politely without also firing a screen-reader
    // alert for every console noise thrown behind the overlay.
    this.root.setAttribute('role', 'alertdialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'celly-error-title');

    const card = document.createElement('div');
    card.className = 'error-boundary-card';

    const kicker = document.createElement('span');
    kicker.className = 'eyebrow';
    kicker.textContent = copy.kicker;

    this.title = document.createElement('h1');
    this.title.id = 'celly-error-title';
    this.title.textContent = copy.title;

    this.lead = document.createElement('p');
    this.lead.className = 'error-boundary-lead';
    this.lead.textContent = copy.lead;

    this.message = document.createElement('p');
    this.message.className = 'error-boundary-message';

    const details = document.createElement('details');
    details.className = 'error-boundary-details';
    const summary = document.createElement('summary');
    summary.textContent = copy.detailSummary;
    this.detailText = document.createElement('pre');
    details.append(summary, this.detailText);

    const actions = document.createElement('div');
    actions.className = 'error-boundary-actions';
    this.retryButton = document.createElement('button');
    this.retryButton.className = 'btn primary';
    this.retryButton.type = 'button';
    this.retryButton.textContent = copy.retry;
    this.retryButton.addEventListener('click', () => this.opts.onRetry());
    this.reloadButton = document.createElement('button');
    this.reloadButton.className = 'btn ghost';
    this.reloadButton.type = 'button';
    this.reloadButton.textContent = copy.reload;
    this.reloadButton.addEventListener('click', () => window.location.reload());
    actions.append(this.retryButton, this.reloadButton);

    card.append(kicker, this.title, this.lead, this.message, details, actions);
    this.root.append(card);

    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      if (event.shiftKey && document.activeElement === this.retryButton) {
        event.preventDefault();
        this.reloadButton.focus();
      } else if (!event.shiftKey && document.activeElement === this.reloadButton) {
        event.preventDefault();
        this.retryButton.focus();
      }
    });
  }

  /** Mount the overlay so it can receive failures before anything else is ready. */
  attach(parent: HTMLElement): void {
    parent.append(this.root);
  }

  /** Populate the overlay and reveal it. Repeated failures only update the details. */
  show(reason: unknown): void {
    const copy = this.copy();
    this.title.textContent = copy.title;
    this.lead.textContent = copy.lead;
    this.retryButton.textContent = copy.retry;
    this.reloadButton.textContent = copy.reload;

    this.message.textContent = describe(reason);
    this.detailText.textContent = detailText(reason);
    this.root.hidden = false;
    this.retryButton.focus();
    this.shown = true;
  }

  hide(): void {
    this.root.hidden = true;
    this.shown = false;
  }

  get isShown(): boolean {
    return this.shown;
  }

  private copy(): ErrorBoundaryCopy {
    try {
      const stored = loadJSON<{ language?: unknown }>('celly:v02:settings', {});
      return COPY[stored.language === 'fr' ? 'fr' : 'en'];
    } catch {
      return COPY.en;
    }
  }
}

function describe(reason: unknown): string {
  return reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
}

function detailText(reason: unknown): string {
  if (reason instanceof Error && reason.stack) return reason.stack;
  try {
    return JSON.stringify(reason, null, 2);
  } catch {
    return String(reason);
  }
}
