/**
 * The post-experience survey.
 *
 * Short on purpose: four Likert items, one preference pick, one 0–10 recommendation and a free
 * comment. Every item maps to a column of the exported CSV, so the four questions the study asks
 * (how hard was it, how different was it, how effective was it, would you do it again) can be
 * compared between the three interaction modes without any re-coding.
 */

import type { ButtonRegistry } from '../ui/buttons';
import type { Language } from '../types';
import { PREFERENCE_SCALE, type Preference, type SurveyAnswers } from './types';
import { escapeHtml } from '../ui/dom';

export const COPY = {
  en: {
    kicker: 'One last thing',
    title: 'How was it?',
    lead: 'Three scales and one comment. There is no right answer — we are comparing three ways of studying the same cell, and your honest scale position is the data.',
    difficulty: 'How hard was it to learn the cell this way?',
    difficultyLow: 'Very easy',
    difficultyHigh: 'Very hard',
    difference: 'How different was this from your usual way of studying?',
    differenceLow: 'Identical',
    differenceHigh: 'Completely different',
    effectiveness: 'Compared with your usual way of studying, how well did this work for you?',
    effectivenessLow: 'Much worse',
    effectivenessHigh: 'Much better',
    preference: 'Would you rather study this cell again like this, instead of your usual way?',
    muchLess: 'Much less',
    less: 'Somewhat less',
    same: 'Same',
    more: 'Somewhat more',
    muchMore: 'Much more',
    recommend: 'Would you recommend this to a classmate who has to learn the same thing?',
    recommendLow: 'Not at all',
    recommendHigh: 'Absolutely',
    comment: 'Anything you want to add? (optional)',
    commentPlaceholder: 'What helped, what got in the way, what surprised you…',
    submit: 'Send my answers',
    missing: 'Answer every scale before sending — blank rows cannot be compared.',
    scale: 'Scale'
  },
  fr: {
    kicker: 'Une dernière chose',
    title: 'Comment c’était ?',
    lead: 'Trois échelles et un commentaire. Il n’y a pas de bonne réponse : nous comparons trois façons d’étudier la même cellule, et votre position sur l’échelle est la donnée.',
    difficulty: 'À quel point était-ce difficile d’apprendre la cellule de cette façon ?',
    difficultyLow: 'Très facile',
    difficultyHigh: 'Très difficile',
    difference: 'En quoi était-ce différent de votre façon habituelle d’étudier ?',
    differenceLow: 'Identique',
    differenceHigh: 'Complètement différent',
    effectiveness: 'Comparé à votre façon habituelle d’étudier, à quel point cela a-t-il fonctionné pour vous ?',
    effectivenessLow: 'Bien moins bien',
    effectivenessHigh: 'Bien mieux',
    preference: 'Préféreriez-vous étudier cette cellule à nouveau de cette façon, plutôt qu’à votre manière ?',
    muchLess: 'Bien moins',
    less: 'Un peu moins',
    same: 'Pareil',
    more: 'Un peu plus',
    muchMore: 'Bien plus',
    recommend: 'Recommanderiez-vous cela à un camarade qui doit apprendre la même chose ?',
    recommendLow: 'Pas du tout',
    recommendHigh: 'Absolument',
    comment: 'Quelque chose à ajouter ? (facultatif)',
    commentPlaceholder: 'Ce qui a aidé, ce qui a gêné, ce qui vous a surpris…',
    submit: 'Envoyer mes réponses',
    missing: 'Répondez à chaque échelle avant d’envoyer — une ligne vide ne peut pas être comparée.',
    scale: 'Échelle'
  }
} as const;

type LikertKey = 'difficulty' | 'difference' | 'effectiveness';

const PREFERENCE_LABEL_KEYS: Record<Preference, 'muchLess' | 'less' | 'same' | 'more' | 'muchMore'> = {
  'much-less': 'muchLess',
  less: 'less',
  same: 'same',
  more: 'more',
  'much-more': 'muchMore'
};

export interface SurveyOptions {
  language: Language;
  modeTitle: string;
  onComplete: (answers: SurveyAnswers) => void;
}

export class SurveyForm {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private likert: Record<LikertKey, number> = { difficulty: 0, difference: 0, effectiveness: 0 };
  private preference: Preference | null = null;
  private recommend = -1;
  private comment = '';
  private error = '';
  private unregister: Array<() => void> = [];

  constructor(
    private readonly registry: ButtonRegistry,
    private readonly opts: SurveyOptions
  ) {
    this.root = document.createElement('section');
    this.root.className = 'study-card study-survey';
    this.body = document.createElement('div');
    this.body.className = 'study-survey-body';
    this.root.append(this.body);
    this.render();
  }

  dispose(): void {
    for (const fn of this.unregister) fn();
    this.unregister = [];
  }

  /**
   * Translate in place. The picks already made are the data, so they must survive the
   * re-render — only the labels change.
   */
  setLanguage(language: Language): void {
    this.opts.language = language;
    this.render();
  }

  private render(): void {
    const ui = COPY[this.opts.language];
    this.teardown();
    this.body.innerHTML = `
      <div class="study-survey-head">
        <span class="eyebrow">${ui.kicker}</span>
        <h2>${ui.title}</h2>
        <p class="study-survey-lead">${ui.lead}</p>
        <p class="study-survey-mode">${escapeHtml(this.opts.modeTitle)}</p>
      </div>

      ${this.likertBlock('difficulty', ui.difficulty, ui.difficultyLow, ui.difficultyHigh)}
      ${this.likertBlock('difference', ui.difference, ui.differenceLow, ui.differenceHigh)}
      ${this.likertBlock('effectiveness', ui.effectiveness, ui.effectivenessLow, ui.effectivenessHigh)}

      <fieldset class="survey-item">
        <legend>${ui.preference}</legend>
        <div class="survey-choice">
          ${PREFERENCE_SCALE.map(
            (value) => `
            <label class="survey-choice-option" data-on="${this.preference === value}">
              <input type="radio" name="survey-preference" value="${value}" ${this.preference === value ? 'checked' : ''}>
              <span>${ui[PREFERENCE_LABEL_KEYS[value]]}</span>
            </label>`
          ).join('')}
        </div>
      </fieldset>

      <fieldset class="survey-item">
        <legend>${ui.recommend}</legend>
        <div class="survey-nps">
          ${Array.from({ length: 11 }, (_, i) => `
            <label class="survey-nps-point" data-on="${this.recommend === i}">
              <input type="radio" name="survey-recommend" value="${i}" ${this.recommend === i ? 'checked' : ''}>
              <span>${i}</span>
            </label>`).join('')}
        </div>
        <p class="survey-scale-note"><span>${ui.recommendLow}</span><span>${ui.recommendHigh}</span></p>
      </fieldset>

      <label class="survey-item survey-comment">
        <span>${ui.comment}</span>
        <textarea rows="4" placeholder="${escapeHtml(ui.commentPlaceholder)}" maxlength="2000"></textarea>
      </label>

      ${
        this.error
          ? `<p class="survey-error" role="alert">${escapeHtml(this.error)}</p>`
          : ''
      }
      <div class="survey-actions">
        <button class="btn primary" type="button" data-survey="submit">${ui.submit}</button>
      </div>
    `;

    for (const btn of this.body.querySelectorAll<HTMLButtonElement>('[data-likert]')) {
      const key = btn.dataset.likert as LikertKey;
      const value = Number(btn.dataset.value);
      const handler = (): void => {
        this.likert[key] = value;
        this.render();
      };
      btn.addEventListener('click', handler);
      this.unregister.push(this.registry.register(`survey:${key}:${value}`, btn, handler));
    }
    for (const input of this.body.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
      input.addEventListener('change', () => {
        if (input.name === 'survey-preference') {
          this.preference = input.value as Preference;
        } else {
          this.recommend = Number(input.value);
        }
        this.render();
      });
    }
    const textarea = this.body.querySelector<HTMLTextAreaElement>('textarea');
    if (textarea) {
      // The markup is rebuilt on every pick; without this, choosing a scale value would erase
      // whatever the participant had already typed.
      textarea.value = this.comment;
      textarea.addEventListener('input', () => {
        this.comment = textarea.value;
      });
    }
    const submit = this.body.querySelector<HTMLButtonElement>('[data-survey="submit"]');
    if (submit) {
      const handler = (): void => this.submit();
      submit.addEventListener('click', handler);
      this.unregister.push(this.registry.register('survey:submit', submit, handler));
    }
    this.registry.refreshAll();
  }

  private likertBlock(key: LikertKey, label: string, low: string, high: string): string {
    const ui = COPY[this.opts.language];
    return `
      <fieldset class="survey-item">
        <legend>${escapeHtml(label)}</legend>
        <div class="survey-likert">
          ${[1, 2, 3, 4, 5]
            .map(
              (value) => `
            <button class="survey-likert-point" type="button" data-likert="${key}" data-value="${value}" data-on="${this.likert[key] === value}" aria-label="${value}">
              <span>${value}</span>
            </button>`
            )
            .join('')}
        </div>
        <p class="survey-scale-note"><span>${escapeHtml(low)}</span><span>${ui.scale} 1–5</span><span>${escapeHtml(high)}</span></p>
      </fieldset>`;
  }

  private submit(): void {
    const ui = COPY[this.opts.language];
    const missingLikert =
      this.likert.difficulty < 1 || this.likert.difference < 1 || this.likert.effectiveness < 1;
    if (missingLikert || !this.preference || this.recommend < 0) {
      this.error = ui.missing;
      this.render();
      return;
    }
    this.opts.onComplete({
      difficulty: this.likert.difficulty,
      difference: this.likert.difference,
      effectiveness: this.likert.effectiveness,
      preference: this.preference,
      recommend: this.recommend,
      comment: this.comment.trim()
    });
  }

  private teardown(): void {
    for (const fn of this.unregister) fn();
    this.unregister = [];
  }
}