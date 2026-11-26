/**
 * The measurement phase, shared by every interaction mode.
 *
 * Text mode enters it through the textbook; hands and mouse modes open it as an overlay from the
 * top bar. Either way the participant answers the same ten questions and the same four survey
 * items, so the three groups produce rows that can sit side by side in one spreadsheet.
 */

import type { ButtonRegistry } from '../../ui/buttons';
import type { Language } from '../../types';
import type { StudyStore } from '../../study/store';
import { buildQuiz, StudyQuiz } from '../../study/studyQuiz';
import { SurveyForm } from '../../study/surveyForm';
import { TextbookPage } from './textbook';
import { MCQS } from '../../data/catalog';
import { quizRatio } from '../../study/store';
import { MODE_COPY } from '../../study/modeCopy';
import type { InteractionMode, QuizAnswer } from '../../study/types';
import { escapeHtml } from '../../ui/dom';
import { downloadText } from '../../study/download';

export const COPY = {
  en: {
    close: 'Close',
    resultKicker: 'Quiz complete',
    resultTitle: 'What stuck',
    resultLead: (correct: number, total: number) => `${correct} of ${total} correct. The score is not the point — the comparison between the three groups is.`,
    continueSurvey: 'Continue to the short survey',
    surveyKicker: 'Questionnaire',
    doneKicker: 'Study complete',
    doneTitle: 'Thank you — you are one data point',
    doneLead: 'Your answers are stored on this device under the participant code below. Nothing has been uploaded.',
    code: 'Participant code',
    modeLabel: 'Mode',
    score: 'Quiz score',
    reading: 'Reading time',
    minutes: (n: number) => `${n} min`,
    download: 'Download my profile (JSON)',
    downloadAll: 'Export every participant (CSV)',
    again: 'Start a new participant',
    restartNote: 'Starting a new participant reloads the app with a fresh code.',
    quizNote: 'Ten questions drawn from the same bank the Test page uses.'
  },
  fr: {
    close: 'Fermer',
    resultKicker: 'Quiz terminé',
    resultTitle: 'Ce qui est resté',
    resultLead: (correct: number, total: number) => `${correct} bonnes réponses sur ${total}. Le score n’est pas le but — c’est la comparaison entre les trois groupes qui compte.`,
    continueSurvey: 'Continuer vers le court questionnaire',
    surveyKicker: 'Questionnaire',
    doneKicker: 'Étude terminée',
    doneTitle: 'Merci — vous êtes un point de données',
    doneLead: 'Vos réponses sont enregistrées sur cet appareil sous le code participant ci-dessous. Rien n’a été envoyé.',
    code: 'Code participant',
    modeLabel: 'Mode',
    score: 'Score au quiz',
    reading: 'Temps de lecture',
    minutes: (n: number) => `${n} min`,
    download: 'Télécharger mon profil (JSON)',
    downloadAll: 'Exporter tous les participants (CSV)',
    again: 'Commencer un nouveau participant',
    restartNote: 'Commencer un nouveau participant recharge l’application avec un nouveau code.',
    quizNote: 'Dix questions tirées de la même banque que la page Test.'
  }
} as const;

export interface StudyLayerOptions {
  study: StudyStore;
  language: Language;
  mode: InteractionMode;
  /** False for the text condition, where the study surface is the whole app. */
  allowClose: boolean;
  /** Immersive modes close back to the lab; text mode reopens the reading surface. */
  onClose: () => void;
  onShowData: () => void;
}

type View = 'reading' | 'quiz' | 'result' | 'survey' | 'done';

export class StudyLayer {
  readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private language: Language;
  private view: View = 'quiz';
  private textbook: TextbookPage | null = null;
  private quiz: StudyQuiz | null = null;
  private survey: SurveyForm | null = null;
  private answers: QuizAnswer[] = [];
  private lastFlush = 0;
  private readingTimer = 0;

  constructor(
    private readonly registry: ButtonRegistry,
    private readonly opts: StudyLayerOptions
  ) {
    this.language = opts.language;
    this.root = document.createElement('div');
    this.root.className = 'study-layer';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'celly-study-title');

    const bar = document.createElement('div');
    bar.className = 'study-bar';
    bar.innerHTML = `<span class="brand-word">CELLY</span><span class="eyebrow">${MODE_COPY[this.language][opts.mode].short}</span>`;

    // The researcher needs a way into the profiles from the text condition too, where the app's
    // top bar is hidden. It is a quiet link, not a participant-facing control.
    const data = document.createElement('button');
    data.className = 'study-data-link';
    data.type = 'button';
    data.textContent = opts.language === 'fr' ? 'Données de l’étude' : 'Study data';
    data.addEventListener('click', () => this.opts.onShowData());
    this.registry.register('study:data', data, () => this.opts.onShowData());
    bar.append(data);

    this.closeButton = document.createElement('button');
    this.closeButton.className = 'icon-btn study-close';
    this.closeButton.type = 'button';
    this.closeButton.textContent = '×';
    this.closeButton.hidden = !opts.allowClose;
    this.closeButton.addEventListener('click', () => this.close());
    bar.append(this.closeButton);

    this.card = document.createElement('div');
    this.card.className = 'study-layer-body';

    this.root.append(bar, this.card);
    document.addEventListener('keydown', this.onKeyDown);
  }

  get isOpen(): boolean {
    return this.root.classList.contains('is-open');
  }

  /** `withReading` is true for the text condition only. */
  open(withReading: boolean): void {
    this.root.classList.add('is-open');
    this.root.dataset.mode = this.opts.mode;
    if (withReading) this.showReading();
    else this.showQuiz();
  }

  close(): void {
    if (!this.isOpen) return;
    this.flushReading();
    this.root.classList.remove('is-open');
    this.teardown();
    this.opts.onClose();
  }

  /** App teardown: release everything without running the close callback. */
  dispose(): void {
    this.flushReading();
    this.teardown();
    this.root.remove();
  }

  setLanguage(language: Language): void {
    this.language = language;
    this.closeButton.setAttribute('aria-label', COPY[this.language].close);
    if (this.isOpen) this.renderCurrent();
  }

  private renderCurrent(): void {
    switch (this.view) {
      case 'reading':
        this.textbook?.setLanguage(this.language);
        break;
      case 'quiz':
        // Rebuilding here would discard the answers already given: translate in place instead.
        this.quiz?.setLanguage(this.language);
        break;
      case 'survey':
        this.survey?.setLanguage(this.language);
        break;
      case 'done':
        this.showDone();
        break;
      default:
        this.showResult();
    }
  }

  // --------------------------------------------------------------------- reading

  private showReading(): void {
    this.view = 'reading';
    this.teardown();
    this.textbook = new TextbookPage(this.registry, {
      language: this.language,
      onReading: () => undefined,
      onStartQuiz: () => {
        this.flushReading();
        this.showQuiz();
      }
    });
    this.card.append(this.textbook.root);
    this.textbook.start();
    this.closeButton.hidden = false;
    this.startReadingClock();
    requestAnimationFrame(() => this.registry.refreshAll());
  }

  private startReadingClock(): void {
    this.stopReadingClock();
    this.lastFlush = this.textbook?.readingSeconds ?? 0;
    this.readingTimer = window.setInterval(() => {
      if (document.hidden || !this.textbook) return;
      const total = this.textbook.readingSeconds;
      const delta = total - this.lastFlush;
      if (delta > 0) {
        this.opts.study.addReading(delta);
        this.lastFlush = total;
      }
    }, 15_000);
  }

  private stopReadingClock(): void {
    if (this.readingTimer) window.clearInterval(this.readingTimer);
    this.readingTimer = 0;
  }

  /** Flush the seconds the textbook accumulated since the last 15-second tick. */
  private flushReading(): void {
    this.stopReadingClock();
    if (!this.textbook) return;
    const delta = this.textbook.readingSeconds - this.lastFlush;
    if (delta > 0) this.opts.study.addReading(delta);
    this.lastFlush = this.textbook.readingSeconds;
  }

  // ------------------------------------------------------------------------ quiz

  private showQuiz(): void {
    this.view = 'quiz';
    this.teardown();
    // A reopened overlay starts a new quiz; keeping the previous answers would double-count them.
    this.answers = [];
    const items = buildQuiz(MCQS, 10);
    // An empty question bank would makes the quiz call onDone from its own constructor, while
    // `this.quiz` is still undefined. Defensive: that shape cannot ship, but it must not hang.
    if (items.length === 0) {
      this.showResult();
      return;
    }
    this.quiz = new StudyQuiz(this.registry, {
      language: this.language,
      items,
      onAnswer: (answer) => {
        this.answers.push(answer);
        // Persist after every question: closing the tab mid-quiz must not lose the answers
        // already given, or the participant would be counted with an empty quiz.
        this.opts.study.recordQuiz(this.answers, items.length);
      },
      onDone: () => this.showResult()
    });
    this.card.append(this.quiz.root);
    this.closeButton.hidden = false;
    requestAnimationFrame(() => this.registry.refreshAll());
  }

  private showResult(): void {
    this.view = 'result';
    this.teardown();
    const ui = COPY[this.language];
    const correct = this.answers.filter((a) => a.correct).length;
    const total = Math.max(this.answers.length, 10);
    const box = document.createElement('section');
    box.className = 'study-card study-result';
    box.innerHTML = `
      <span class="eyebrow">${ui.resultKicker}</span>
      <h2 id="celly-study-title">${ui.resultTitle}</h2>
      <p class="study-result-score"><b>${correct}</b> / ${total}</p>
      <p class="study-result-lead">${ui.resultLead(correct, total)}</p>
      <div class="study-result-actions">
        <button class="btn primary" type="button" data-study="survey">${ui.continueSurvey}</button>
      </div>
    `;
    const next = box.querySelector<HTMLButtonElement>('[data-study="survey"]');
    if (next) {
      const handler = (): void => this.showSurvey();
      next.addEventListener('click', handler);
      this.registry.register('study:to-survey', next, handler);
    }
    this.card.append(box);
    requestAnimationFrame(() => this.registry.refreshAll());
  }

  // ---------------------------------------------------------------------- survey

  private showSurvey(): void {
    this.view = 'survey';
    this.teardown();
    this.survey = new SurveyForm(this.registry, {
      language: this.language,
      modeTitle: MODE_COPY[this.language][this.opts.mode].title,
      onComplete: (answers) => {
        this.opts.study.recordSurvey(answers);
        this.showDone();
      }
    });
    this.card.append(this.survey.root);
    requestAnimationFrame(() => this.registry.refreshAll());
  }

  // ------------------------------------------------------------------------ done

  private showDone(): void {
    this.view = 'done';
    this.teardown();
    const ui = COPY[this.language];
    const session = this.opts.study.finish();
    if (!session) {
      this.showQuiz();
      return;
    }
    const ratio = quizRatio(session);
    const score = ratio === null ? '—' : `${Math.round(ratio * 100)}%`;
    const box = document.createElement('section');
    box.className = 'study-card study-done';
    box.innerHTML = `
      <span class="eyebrow">${ui.doneKicker}</span>
      <h2 id="celly-study-title">${ui.doneTitle}</h2>
      <p class="study-result-lead">${ui.doneLead}</p>
      <dl class="study-done-facts">
        <div><dt>${ui.code}</dt><dd>${escapeHtml(session.participantId)}</dd></div>
        <div><dt>${ui.modeLabel}</dt><dd>${MODE_COPY[this.language][this.opts.mode].title}</dd></div>
        <div><dt>${ui.score}</dt><dd>${score}</dd></div>
        <div><dt>${ui.reading}</dt><dd>${ui.minutes(Math.round(session.readingSeconds / 60))}</dd></div>
      </dl>
      <div class="study-done-actions">
        <button class="btn primary" type="button" data-study="mine">${ui.download}</button>
        <button class="btn ghost" type="button" data-study="all">${ui.downloadAll}</button>
        <button class="btn ghost" type="button" data-study="again">${ui.again}</button>
      </div>
      <p class="study-done-note">${ui.restartNote}</p>
    `;
    const wire = (key: string, handler: () => void): void => {
      const btn = box.querySelector<HTMLButtonElement>(`[data-study="${key}"]`);
      if (!btn) return;
      btn.addEventListener('click', handler);
      this.registry.register(`study:done:${key}`, btn, handler);
    };
    wire('mine', () =>
      downloadText(
        `celly-participant-${session.participantId}.json`,
        JSON.stringify(session, null, 2)
      )
    );
    wire('all', () => downloadText('celly-study.csv', csvOf(this.opts.study)));
    wire('again', () => {
      // Only reload: `finish()` already archived this participant and cleared the session, so
      // the next participant gets a fresh code and the gate. Clearing here would destroy every
      // earlier participant on the device — the whole dataset for the study.
      window.location.reload();
    });
    this.card.append(box);
    requestAnimationFrame(() => this.registry.refreshAll());
  }

  // ------------------------------------------------------------------- lifecycle

  private teardown(): void {
    this.stopReadingClock();
    this.textbook?.dispose();
    this.textbook = null;
    this.quiz?.dispose();
    this.quiz = null;
    this.survey?.dispose();
    this.survey = null;
    this.card.textContent = '';
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen || event.key !== 'Escape') return;
    // The text condition must be finished to produce a comparable row, but a participant can
    // still leave: the session stays in progress and the gate offers to resume it.
    if (this.view === 'done' || !this.opts.allowClose) return;
    event.preventDefault();
    this.close();
  };
}

function csvOf(study: StudyStore): string {
  // Imported lazily through the store module to keep the UI file free of CSV formatting rules.
  return study.exportCsv();
}