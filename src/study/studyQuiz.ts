/**
 * The study quiz.
 *
 * Same questions as the app's own test page, but stripped to the part the study needs: every
 * answer is timed and reported back, no Leitner bookkeeping and no score screen to game. The
 * result is what gets stored on the participant profile.
 */

import type { ButtonRegistry } from '../ui/buttons';
import type { Language, Question } from '../types';
import { loc, prepareQuestion, shuffled } from '../data/catalog';
import { makeRng } from '../core/math';
import type { QuizAnswer } from './types';
import { escapeHtml } from '../ui/dom';

export const COPY = {
  en: {
    question: (i: number, n: number) => `Question ${i} of ${n}`,
    next: 'Next question',
    finish: 'See my result',
    correct: 'Correct',
    incorrect: 'Not quite',
    why: 'Why',
    retry: 'Answer again',
    answered: 'Answered',
    progress: (i: number, n: number) => `${i} / ${n} answered`
  },
  fr: {
    question: (i: number, n: number) => `Question ${i} sur ${n}`,
    next: 'Question suivante',
    finish: 'Voir mon résultat',
    correct: 'Correct',
    incorrect: 'Pas tout à fait',
    why: 'Pourquoi',
    retry: 'Répondre à nouveau',
    answered: 'Répondu',
    progress: (i: number, n: number) => `${i} / ${n} répondues`
  }
} as const;

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

/** Deterministic sample of `count` questions, with per-question choice order. */
export function buildQuiz(
  questions: readonly Question[],
  count: number,
  seed = Date.now()
): Array<{ question: Question; order: number[]; answerIndex: number }> {
  const rng = makeRng(seed);
  const picked = shuffled(questions, rng).slice(0, Math.min(count, questions.length));
  return picked.map((question) => {
    const prepared = prepareQuestion(question, rng);
    return { question, order: prepared.order, answerIndex: prepared.answerIndex };
  });
}

export interface StudyQuizOptions {
  language: Language;
  items: Array<{ question: Question; order: number[]; answerIndex: number }>;
  onAnswer: (answer: QuizAnswer) => void;
  onDone: (answers: QuizAnswer[]) => void;
}

export class StudyQuiz {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly answers: QuizAnswer[] = [];
  private index = 0;
  /** Chosen option for the current question, -1 while unanswered. */
  private chosen = -1;
  private askedAt = Date.now();
  private unregister: Array<() => void> = [];

  constructor(
    private readonly registry: ButtonRegistry,
    private readonly opts: StudyQuizOptions
  ) {
    this.root = document.createElement('section');
    this.root.className = 'study-card study-quiz';
    this.body = document.createElement('div');
    this.body.className = 'study-quiz-body';
    this.root.append(this.body);
    this.render();
  }

  dispose(): void {
    for (const fn of this.unregister) fn();
    this.unregister = [];
  }

  /** Translate in place — answers given so far stay on the profile. */
  setLanguage(language: Language): void {
    this.opts.language = language;
    this.render();
  }

  get progress(): { answered: number; total: number } {
    return { answered: this.answers.length, total: this.opts.items.length };
  }

  private render(): void {
    // Every render replaces the option buttons, so the previous bindings must be released
    // before the new nodes are registered.
    for (const fn of this.unregister) fn();
    this.unregister.length = 0;
    const ui = COPY[this.opts.language];
    const total = this.opts.items.length;
    if (this.index >= total) {
      const correct = this.answers.filter((a) => a.correct).length;
      this.body.innerHTML = `
        <div class="quiz-result">
          <span class="eyebrow">${ui.answered}</span>
          <p class="quiz-score"><b>${correct}</b> / ${total}</p>
          <p class="quiz-score-note">${escapeHtml(ui.progress(correct, total))}</p>
        </div>`;
      this.opts.onDone(this.answers);
      return;
    }
    const item = this.opts.items[this.index];
    const q = item.question;
    const answered = this.chosen >= 0;
    this.body.innerHTML = `
      <div class="study-quiz-head">
        <span class="eyebrow">${escapeHtml(ui.question(this.index + 1, total))}</span>
        <span class="study-quiz-count">${escapeHtml(ui.progress(this.answers.length, total))}</span>
      </div>
      <p class="study-quiz-stem">${escapeHtml(loc(q.question, this.opts.language))}</p>
      <div class="study-quiz-options" role="group" aria-label="${escapeHtml(loc(q.question, this.opts.language))}">
        ${item.order
          .map(
            (original, i) => `
          <button class="quiz-option" type="button" data-quiz="${i}" data-state="${
            answered ? (i === item.answerIndex ? 'right' : i === this.chosen ? 'wrong' : 'idle') : 'idle'
          }" ${answered ? 'disabled' : ''}>
            <span class="quiz-letter">${LETTERS[i]}</span>
            <span class="quiz-text">${escapeHtml(loc(q.options[original], this.opts.language))}</span>
          </button>`
          )
          .join('')}
      </div>
      ${
        answered
          ? `<div class="quiz-feedback" data-tone="${this.chosen === item.answerIndex ? 'good' : 'bad'}">
              <b>${this.chosen === item.answerIndex ? ui.correct : ui.incorrect}</b>
              <p>${escapeHtml(loc(q.explanation, this.opts.language))}</p>
            </div>`
          : ''
      }
      <div class="study-quiz-actions">
        ${answered ? `<button class="btn primary" type="button" data-quiz-next>${this.index === total - 1 ? ui.finish : ui.next}</button>` : ''}
      </div>
    `;

    if (!answered) {
      for (const btn of this.body.querySelectorAll<HTMLButtonElement>('[data-quiz]')) {
        const handler = () => this.answer(Number(btn.dataset.quiz));
        btn.addEventListener('click', handler);
        const id = `study:quiz:${this.index}:${btn.dataset.quiz as string}`;
        this.unregister.push(this.registry.register(id, btn, handler));
      }
    } else {
      const next = this.body.querySelector<HTMLButtonElement>('[data-quiz-next]');
      if (next) {
        const handler = () => {
          this.index += 1;
          this.chosen = -1;
          this.askedAt = Date.now();
          this.render();
        };
        next.addEventListener('click', handler);
        this.unregister.push(this.registry.register(`study:quiz:next:${this.index}`, next, handler));
      }
    }
    this.registry.refreshAll();
  }

  private answer(index: number): void {
    if (this.chosen >= 0) return;
    this.chosen = index;
    const item = this.opts.items[this.index];
    const record: QuizAnswer = {
      questionId: item.question.id,
      correct: index === item.answerIndex,
      ms: Date.now() - this.askedAt
    };
    this.answers.push(record);
    this.opts.onAnswer(record);
    this.render();
  }
}