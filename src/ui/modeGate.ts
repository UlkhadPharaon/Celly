/**
 * First-run gate: which kind of participant are you?
 *
 * The study compares three ways of learning the same material, so the mode is a data field, not
 * a cosmetic preference. Choosing it here (before any UI is seen) is what makes the three groups
 * comparable, and it is stored with the session so every later event is tagged with the mode.
 */

import type { ButtonRegistry } from './buttons';
import type { Language } from '../types';
import type { InteractionMode } from '../study/types';
import { svgIcon, ICONS } from './dom';

export const GATE_COPY = {
  en: {
    kicker: 'Celly · study',
    title: 'How do you want to learn about the cell?',
    lead: 'Three ways to study the exact same material. Nothing is graded here — the way you choose is itself part of the data.',
    hands: 'With my hands',
    handsSub: 'Bare-hand control through the webcam: pinch, rotate and scale the 3D cell yourself.',
    mouse: 'With a mouse',
    mouseSub: 'The same 3D cell, steered with clicks and dragging. No camera.',
    text: 'By reading',
    textSub: 'A plain textbook page: chapters and figures described in words. No 3D, no camera.',
    privacy: 'The webcam is processed on this device. Nothing is uploaded.',
    storage: 'Answers stay on this device until you export them.',
    resume: 'A session on this device is still unfinished.',
    resumeAction: 'Continue it',
    newAction: 'Start a new participant',
    done: (count: number) => `${count} participant${count === 1 ? '' : 's'} recorded on this device`,
    data: 'View study data'
  },
  fr: {
    kicker: 'Celly · étude',
    title: 'Comment voulez-vous apprendre la cellule ?',
    lead: 'Trois façons d’étudier exactement le même contenu. Rien n’est noté ici : votre choix fait lui-même partie des données.',
    hands: 'Avec mes mains',
    handsSub: 'Contrôle à mains nues par la webcam : pincez, tournez et redimensionnez la cellule 3D vous-même.',
    mouse: 'Avec une souris',
    mouseSub: 'La même cellule 3D, pilotée par clics et glissements. Sans caméra.',
    text: 'En lisant',
    textSub: 'Une page de manuel simple : chapitres et figures décrites en mots. Sans 3D, sans caméra.',
    privacy: 'La webcam est traitée sur cet appareil. Rien n’est envoyé.',
    storage: 'Les réponses restent sur cet appareil jusqu’à l’export.',
    resume: 'Une session sur cet appareil n’est pas terminée.',
    resumeAction: 'La continuer',
    newAction: 'Nouveau participant',
    done: (count: number) => `${count} participant${count === 1 ? '' : 's'} enregistré${count === 1 ? '' : 's'} sur cet appareil`,
    data: 'Voir les données'
  }
};

export interface ModeGateOptions {
  onChoose: (mode: InteractionMode) => void;
  onResume: () => void;
  onShowData: () => void;
}

export class ModeGate {
  readonly root: HTMLElement;
  private language: Language = 'en';
  private readonly card: HTMLElement;
  private unregister: Array<() => void> = [];
  /** Hidden while a session is in progress: the gate is a first-run screen, not a menu. */
  private resumable = false;
  private recorded = 0;

  constructor(
    private readonly registry: ButtonRegistry,
    private readonly opts: ModeGateOptions
  ) {
    this.root = document.createElement('div');
    this.root.className = 'mode-gate';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'celly-gate-title');
    this.card = document.createElement('div');
    this.card.className = 'mode-gate-card';
    this.root.append(this.card);
    document.addEventListener('keydown', this.onKeyDown);
    this.render();
  }

  get isOpen(): boolean {
    return this.root.classList.contains('is-open');
  }

  open(language: Language, options: { resumable: boolean; recorded: number }): void {
    this.language = language;
    this.resumable = options.resumable;
    this.recorded = options.recorded;
    this.root.classList.add('is-open');
    this.render();
    requestAnimationFrame(() => this.card.querySelector<HTMLElement>('[data-celly="choose"]')?.focus());
  }

  close(): void {
    this.root.classList.remove('is-open');
  }

  setLanguage(language: Language): void {
    this.language = language;
    if (this.isOpen) this.render();
  }

  private render(): void {
    this.teardown();
    const copy = GATE_COPY[this.language];
    const options: Array<{ mode: InteractionMode; icon: keyof typeof ICONS; title: string; sub: string }> = [
      { mode: 'hands', icon: 'hand', title: copy.hands, sub: copy.handsSub },
      { mode: 'mouse', icon: 'cursor', title: copy.mouse, sub: copy.mouseSub },
      { mode: 'text', icon: 'book', title: copy.text, sub: copy.textSub }
    ];

    this.card.innerHTML = `
      <div class="mode-gate-head">
        <span class="eyebrow">${copy.kicker}</span>
        <h1 id="celly-gate-title">${copy.title}</h1>
        <p class="mode-gate-lead">${copy.lead}</p>
      </div>
      <div class="mode-gate-options">
        ${options
          .map(
            (option, i) => `
          <button class="mode-option" type="button" data-celly="choose" data-mode="${option.mode}" style="--i:${i}">
            <span class="mode-option-icon">${svgIcon(ICONS[option.icon]).outerHTML}</span>
            <span class="mode-option-text">
              <b>${option.title}</b>
              <span>${option.sub}</span>
            </span>
            <span class="mode-option-go" aria-hidden="true">→</span>
          </button>`
          )
          .join('')}
      </div>
      <div class="mode-gate-foot">
        <p class="mode-gate-note">${svgIcon(ICONS.privacy).outerHTML}<span>${copy.privacy}</span></p>
        <p class="mode-gate-note">${svgIcon(ICONS.database).outerHTML}<span>${copy.storage}</span></p>
        ${
          this.resumable
            ? `<div class="mode-gate-resume">
                 <span>${copy.resume}</span>
                 <button class="btn ghost small" type="button" data-celly="resume">${copy.resumeAction}</button>
               </div>`
            : this.recorded > 0
              ? `<div class="mode-gate-resume">
                   <span>${copy.done(this.recorded)}</span>
                   <button class="btn ghost small" type="button" data-celly="data">${copy.data}</button>
                 </div>`
              : ''
        }
      </div>
    `;

    for (const btn of this.card.querySelectorAll<HTMLButtonElement>('[data-celly]')) {
      const mode = btn.dataset.mode as InteractionMode | undefined;
      const handler =
        btn.dataset.celly === 'choose' && mode
          ? () => {
              this.close();
              this.opts.onChoose(mode);
            }
          : btn.dataset.celly === 'resume'
            ? () => {
                this.close();
                this.opts.onResume();
              }
            : btn.dataset.celly === 'data'
              ? () => this.opts.onShowData()
              : null;
      if (!handler) continue;
      btn.addEventListener('click', handler);
      const id = mode ? `onboarding:${mode}` : `onboarding:${btn.dataset.celly as string}`;
      this.unregister.push(this.registry.register(id, btn, handler));
    }
    this.registry.refreshAll();
  }

  private teardown(): void {
    for (const fn of this.unregister) fn();
    this.unregister = [];
  }

  /** Escape never dismisses the gate: the mode is mandatory data for the study. */
  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen || event.key !== 'Escape') return;
    event.preventDefault();
  };
}