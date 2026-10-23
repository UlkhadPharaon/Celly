import type { Intent, Language, Question } from '../../types';
import { MCQS, MCQ_BY_ID, QUESTIONNAIRES, FLASHCARDS, loc, shuffled } from '../../data/catalog';
import { makeRng } from '../../core/math';
import { type Page, type PageContext } from '../page';
import { LeitnerStore } from './leitner';
import { ProgressStore, gradeRatio, scoreLabel } from './progress';
import { ICONS, svgIcon } from '../../ui/dom';

type View = 'home' | 'mcq' | 'flash' | 'results' | 'flash-results';

interface Prepared {
  order: number[];
  answerIndex: number;
}

interface McqState {
  key: string;
  title: string;
  questions: Question[];
  prepared: Prepared[];
  index: number;
  /** Display index chosen per question; -1 = unanswered. */
  answers: number[];
}

interface FlashState {
  order: string[];
  index: number;
  revealed: boolean;
  results: boolean[];
  missed: string[];
}

const COPY = {
  en: {
    eyebrow: 'Testing knowledge',
    title: 'Prove it.',
    lead: '48 questions · 36 flashcards · 3 guided sets. Every answer is saved on this device.',
    quick: 'Quick quiz',
    quickSub: '10 questions · about 3 minutes',
    full: 'Full exam',
    fullSub: 'All 48 questions, randomised',
    flash: 'Flashcards',
    flashSub: '36 cards · Leitner spaced repetition',
    sets: 'Guided sets',
    setsLead: 'Curated runs that build in difficulty.',
    start: 'Start',
    questions: 'questions',
    best: 'Best',
    attempts: 'attempts',
    mastered: 'cards mastered',
    back: 'All tests',
    question: 'Question',
    next: 'Next question',
    results: 'See results',
    correct: 'Correct',
    incorrect: 'Not quite',
    why: 'Why',
    yourAnswer: 'Your answer',
    rightAnswer: 'Correct answer',
    retry: 'Try again',
    allTests: 'All tests',
    score: 'Score',
    review: 'Review',
    card: 'Card',
    reveal: 'Reveal answer',
    knew: 'I knew it',
    miss: 'I didn’t know',
    done: 'Deck complete',
    known: 'Known',
    missed: 'To review',
    reviewMissed: 'Review missed cards',
    noMissed: 'Nothing to review — a clean run.',
    flipHint: 'Pinch or click to flip',
    swipeHint: 'Swipe right for “knew it”, left for “didn’t”',
    difficulty: { easy: 'Easy', medium: 'Medium', hard: 'Hard' },
    setDone: 'Set complete'
  },
  fr: {
    eyebrow: 'Tester ses connaissances',
    title: 'Prouvez-le.',
    lead: '48 questions · 36 cartes · 3 parcours guidés. Chaque réponse est enregistrée sur cet appareil.',
    quick: 'Quiz express',
    quickSub: '10 questions · environ 3 minutes',
    full: 'Examen complet',
    fullSub: 'Les 48 questions, mélangées',
    flash: 'Cartes mémo',
    flashSub: '36 cartes · répétition espacée Leitner',
    sets: 'Parcours guidés',
    setsLead: 'Des séries choisies, de difficulté croissante.',
    start: 'Commencer',
    questions: 'questions',
    best: 'Meilleur',
    attempts: 'tentatives',
    mastered: 'cartes maîtrisées',
    back: 'Tous les tests',
    question: 'Question',
    next: 'Question suivante',
    results: 'Voir le résultat',
    correct: 'Correct',
    incorrect: 'Pas tout à fait',
    why: 'Pourquoi',
    yourAnswer: 'Votre réponse',
    rightAnswer: 'Bonne réponse',
    retry: 'Réessayer',
    allTests: 'Tous les tests',
    score: 'Score',
    review: 'Révision',
    card: 'Carte',
    reveal: 'Voir la réponse',
    knew: 'Je savais',
    miss: 'Je ne savais pas',
    done: 'Série terminée',
    known: 'Sues',
    missed: 'À revoir',
    reviewMissed: 'Revoir les cartes ratées',
    noMissed: 'Rien à revoir — sans faute.',
    flipHint: 'Pincez ou cliquez pour retourner',
    swipeHint: 'Balayez à droite pour « je savais », à gauche sinon',
    difficulty: { easy: 'Facile', medium: 'Moyen', hard: 'Difficile' },
    setDone: 'Parcours terminé'
  }
};

const LETTERS = ['A', 'B', 'C', 'D'];

export class TestingPage implements Page {
  readonly id = 'test' as const;
  readonly root: HTMLElement;

  private readonly body: HTMLElement;
  private readonly leitner = new LeitnerStore();
  private readonly progress = new ProgressStore();
  private readonly unregister: Array<() => void> = [];
  private view: View = 'home';
  private mcq: McqState | null = null;
  private flash: FlashState | null = null;
  private lastMissed: string[] = [];
  private language: Language;
  private scrollTick = 0;

  constructor(private readonly ctx: PageContext) {
    this.language = ctx.settings.language;
    this.root = document.createElement('section');
    this.root.className = 'page page-test';

    const shell = document.createElement('div');
    shell.className = 'test-shell';
    this.body = document.createElement('div');
    this.body.className = 'test-body glass';
    shell.append(this.body);
    this.root.append(shell);

    this.body.addEventListener('scroll', () => {
      if (this.scrollTick) return;
      this.scrollTick = window.setTimeout(() => {
        this.scrollTick = 0;
        this.ctx.registry.refreshAll();
      }, 80);
    });

    this.render();
  }

  // ------------------------------------------------------------------ lifecycle

  enter(): void {
    this.root.classList.add('is-active');
    requestAnimationFrame(() => this.ctx.registry.refreshAll());
  }

  exit(): void {
    this.root.classList.remove('is-active');
  }

  setLanguage(language: Language): void {
    this.language = language;
    this.render();
  }

  setAutoRotate(): void {
    /* backdrop is static on this page */
  }

  closeOverlay(): void {
    /* the test page has no floating 3D overlay */
  }

  onIntent(intent: Intent): void {
    if (intent.type === 'swipe' && intent.phase === 'end' && Math.abs(intent.progress) > 0.7) {
      if (this.view === 'flash') this.swipeCard(intent.progress > 0);
      else if (this.view === 'mcq') this.swipeQuestion(intent.progress > 0);
    }
  }

  pick(): string | null {
    return null;
  }

  setHovered(): void {
    /* no 3D objects on the test page */
  }

  update(): void {
    /* fully DOM-driven */
  }

  dispose(): void {
    this.clearButtons();
    this.root.remove();
  }

  /** Open a quiz filtered to the questions linked to a knowledge node. */
  openForNode(nodeId: string): void {
    const linked = MCQS.filter((q) => q.linkedIds.includes(nodeId));
    const pool = linked.length >= 4 ? linked : MCQS;
    const rng = makeRng((Date.now() ^ nodeId.length * 7919) >>> 0);
    const picked = shuffled(pool, rng).slice(0, Math.min(10, pool.length));
    this.startMcq(picked, `node:${nodeId}`, this.language === 'fr' ? 'Quiz ciblé' : 'Linked quiz');
  }

  returnHome(): void {
    this.view = 'home';
    this.render();
  }

  // --------------------------------------------------------------------- render

  private render(): void {
    this.clearButtons();
    switch (this.view) {
      case 'home':
        this.renderHome();
        break;
      case 'mcq':
        this.renderMcq();
        break;
      case 'results':
        this.renderResults();
        break;
      case 'flash':
        this.renderFlash();
        break;
      case 'flash-results':
        this.renderFlashResults();
        break;
      default:
        this.renderHome();
    }
    requestAnimationFrame(() => {
      this.ctx.registry.refreshAll();
      this.body.scrollTop = 0;
    });
  }

  private copy(): (typeof COPY)['en'] {
    return COPY[this.language];
  }

  private renderHome(): void {
    const copy = this.copy();
    const cardStats = this.leitner.stats(FLASHCARDS.map((f) => f.id));
    const quickBest = Math.round(this.progress.best('mcq:quick') * 100);

    this.body.innerHTML = `
      <header class="test-head">
        <div>
          <span class="eyebrow">${copy.eyebrow}</span>
          <h1>${copy.title}</h1>
          <p>${copy.lead}</p>
        </div>
        <div class="test-stats">
          <div><b>${quickBest}%</b><span>${copy.best}</span></div>
          <div><b>${cardStats.mastered}/${cardStats.total}</b><span>${copy.mastered}</span></div>
          <div><b>${this.progress.attempts}</b><span>${copy.attempts}</span></div>
        </div>
      </header>

      <div class="mode-grid">
        <button class="mode-card" type="button" data-celly="quick">
          <span class="mode-icon">${svgIcon(ICONS.quiz).outerHTML}</span>
          <b>${copy.quick}</b>
          <span>${copy.quickSub}</span>
          <i class="mode-arrow">${svgIcon(ICONS.arrowRight).outerHTML}</i>
        </button>
        <button class="mode-card" type="button" data-celly="full">
          <span class="mode-icon">${svgIcon(ICONS.test).outerHTML}</span>
          <b>${copy.full}</b>
          <span>${copy.fullSub}</span>
          <i class="mode-arrow">${svgIcon(ICONS.arrowRight).outerHTML}</i>
        </button>
        <button class="mode-card accent-violet" type="button" data-celly="flash">
          <span class="mode-icon">${svgIcon(ICONS.cards).outerHTML}</span>
          <b>${copy.flash}</b>
          <span>${copy.flashSub}</span>
          <i class="mode-arrow">${svgIcon(ICONS.arrowRight).outerHTML}</i>
        </button>
      </div>

      <div class="sets-head">
        <span class="eyebrow">${copy.sets}</span>
        <p>${copy.setsLead}</p>
      </div>
      <div class="set-grid">
        ${QUESTIONNAIRES.map((set, i) => {
          const best = Math.round(this.progress.best(`set:${set.id}`) * 100);
          return `
            <article class="set-card">
              <div class="set-ord">${String(i + 1).padStart(2, '0')}</div>
              <h3>${loc(set.title, this.language)}</h3>
              <p>${loc(set.description, this.language)}</p>
              <div class="set-foot">
                <span>${set.questionIds.length} ${copy.questions}</span>
                ${best > 0 ? `<span class="set-best">${copy.best} ${best}%</span>` : ''}
                <button class="btn ghost small" type="button" data-celly="set-${i}">
                  <span>${copy.start}</span>${svgIcon(ICONS.arrowRight).outerHTML}
                </button>
              </div>
            </article>`;
        }).join('')}
      </div>
    `;

    this.wire('test:quick', '[data-celly="quick"]', () => {
      const rng = makeRng(Date.now() >>> 0);
      const picked = shuffled(MCQS, rng).slice(0, 10);
      this.startMcq(picked, 'mcq:quick', this.copy().quick);
    });
    this.wire('test:full', '[data-celly="full"]', () => {
      const rng = makeRng(Date.now() >>> 0);
      this.startMcq(shuffled(MCQS, rng), 'mcq:full', this.copy().full);
    });
    this.wire('test:flash', '[data-celly="flash"]', () => this.startFlash(FLASHCARDS.map((f) => f.id)));
    QUESTIONNAIRES.forEach((set, i) => {
      this.wire(`test:set:${i}`, `[data-celly="set-${i}"]`, () => this.startSet(set.id));
    });
  }

  private startSet(id: string): void {
    const set = QUESTIONNAIRES.find((s) => s.id === id);
    if (!set) return;
    const questions = set.questionIds.map((qid) => MCQ_BY_ID.get(qid)).filter((q): q is Question => !!q);
    if (!questions.length) return;
    this.startMcq(questions, `set:${set.id}`, loc(set.title, this.language));
  }

  // ------------------------------------------------------------------------ MCQ

  private startMcq(questions: Question[], key: string, title: string): void {
    const rng = makeRng((Date.now() ^ (questions.length * 2654435761)) >>> 0);
    const prepared: Prepared[] = questions.map((q) => {
      const order = shuffled(
        q.options.map((_, i) => i),
        rng
      );
      return { order, answerIndex: order.indexOf(q.answerIndex) };
    });
    this.mcq = {
      key,
      title,
      questions,
      prepared,
      index: 0,
      answers: new Array(questions.length).fill(-1)
    };
    this.view = 'mcq';
    this.render();
  }

  private renderMcq(): void {
    const state = this.mcq;
    if (!state) {
      this.view = 'home';
      this.render();
      return;
    }
    const copy = this.copy();
    const q = state.questions[state.index];
    const prepared = state.prepared[state.index];
    const chosen = state.answers[state.index];
    const answered = chosen >= 0;
    const isLast = state.index === state.questions.length - 1;
    const correct = answered && chosen === prepared.answerIndex;

    this.body.innerHTML = `
      <div class="test-top">
        <button class="icon-btn" type="button" data-celly="home" aria-label="${copy.back}">
          ${svgIcon(ICONS.arrowLeft).outerHTML}
        </button>
        <div class="test-top-title">
          <span class="eyebrow">${state.title}</span>
          <div class="test-progress"><i style="width:${((state.index + (answered ? 1 : 0)) / state.questions.length) * 100}%"></i></div>
        </div>
        <span class="test-count">${state.index + 1} / ${state.questions.length}</span>
      </div>

      <div class="question">
        <div class="question-meta">
          <span class="chip-soft">${q.category}</span>
          <span class="chip-soft">${copy.difficulty[q.difficulty]}</span>
        </div>
        <h2>${loc(q.question, this.language)}</h2>
        <div class="options">
          ${prepared.order
            .map((original, display) => {
              const text = loc(q.options[original], this.language);
              const isAnswer = display === prepared.answerIndex;
              const isChosen = display === chosen;
              let cls = '';
              if (answered) {
                if (isAnswer) cls = 'is-correct';
                else if (isChosen) cls = 'is-wrong';
                else cls = 'is-dim';
              }
              return `
                <button class="option ${cls}" type="button" data-celly="option-${display}" ${
                  answered ? 'disabled' : ''
                }>
                  <span class="option-key">${LETTERS[display] ?? '?'}</span>
                  <span class="option-text">${text}</span>
                  <span class="option-mark">${isAnswer ? svgIcon(ICONS.check).outerHTML : ''}</span>
                </button>`;
            })
            .join('')}
        </div>
        ${
          answered
            ? `<div class="answer-panel ${correct ? 'is-correct' : 'is-wrong'}">
                 <div class="answer-head">
                   <span class="answer-badge">${correct ? svgIcon(ICONS.check).outerHTML : svgIcon(ICONS.close).outerHTML}</span>
                   <b>${correct ? copy.correct : copy.incorrect}</b>
                 </div>
                 <p class="answer-explain"><span>${copy.why}</span> ${loc(q.explanation, this.language)}</p>
               </div>
               <div class="question-foot">
                 <button class="btn primary" type="button" data-celly="next">
                   <span>${isLast ? copy.results : copy.next}</span>
                   ${svgIcon(isLast ? ICONS.check : ICONS.arrowRight).outerHTML}
                 </button>
               </div>`
            : `<div class="question-foot">
                 <span class="question-tip">${this.language === 'fr' ? 'Pincez une réponse' : 'Pinch an answer'}</span>
               </div>`
        }
    `;

    this.wire('test:home', '[data-celly="home"]', () => this.returnHome());
    if (!answered) {
      for (let i = 0; i < prepared.order.length; i++) {
        this.wire(`test:option:${i}`, `[data-celly="option-${i}"]`, () => this.choose(i));
      }
    } else {
      this.wire('test:next', '[data-celly="next"]', () => this.nextQuestion());
    }
  }

  private choose(displayIndex: number): void {
    const state = this.mcq;
    if (!state) return;
    if (state.answers[state.index] >= 0) return;
    state.answers[state.index] = displayIndex;
    this.render();
  }

  private nextQuestion(): void {
    const state = this.mcq;
    if (!state) return;
    if (state.index >= state.questions.length - 1) {
      const correct = state.answers.filter((a, i) => a === state.prepared[i].answerIndex).length;
      this.progress.record(state.key, correct / state.questions.length);
      this.view = 'results';
    } else {
      state.index += 1;
    }
    this.render();
  }

  private swipeQuestion(forward: boolean): void {
    const state = this.mcq;
    if (!state) return;
    if (state.answers[state.index] < 0) return;
    if (forward) this.nextQuestion();
  }

  private renderResults(): void {
    const state = this.mcq;
    if (!state) {
      this.view = 'home';
      this.render();
      return;
    }
    const copy = this.copy();
    const total = state.questions.length;
    const correct = state.answers.filter((a, i) => a === state.prepared[i].answerIndex).length;
    const ratio = correct / total;
    const grade = gradeRatio(ratio);

    this.body.innerHTML = `
      <div class="test-top">
        <button class="icon-btn" type="button" data-celly="home" aria-label="${copy.allTests}">
          ${svgIcon(ICONS.arrowLeft).outerHTML}
        </button>
        <div class="test-top-title"><span class="eyebrow">${state.title}</span></div>
        <span class="test-count">${copy.score}</span>
      </div>

      <div class="results-head">
        <div class="score-ring" style="--p:${ratio.toFixed(3)};--grade:${grade === 'A' ? '#4ade80' : grade === 'B' ? '#60a5fa' : grade === 'C' ? '#fbbf24' : '#fb7185'}">
          <div><b>${Math.round(ratio * 100)}<small>%</small></b><span>${correct} / ${total}</span></div>
        </div>
        <div class="results-copy">
          <span class="eyebrow">${copy.setDone}</span>
          <h2>${scoreLabel(ratio)}</h2>
          <p>${copy.correct}: <b>${correct}</b> · ${copy.incorrect}: <b>${total - correct}</b></p>
          <div class="results-actions">
            <button class="btn primary" type="button" data-celly="retry"><span>${copy.retry}</span>${svgIcon(ICONS.rotate).outerHTML}</button>
            <button class="btn ghost" type="button" data-celly="home"><span>${copy.allTests}</span></button>
          </div>
        </div>
      </div>

      <div class="review">
        <span class="eyebrow">${copy.review}</span>
        <div class="review-list">
          ${state.questions
            .map((q, i) => {
              const chosen = state.answers[i];
              const prepared = state.prepared[i];
              const ok = chosen === prepared.answerIndex;
              const yourText = chosen >= 0 ? loc(q.options[prepared.order[chosen]], this.language) : '—';
              const rightText = loc(q.options[prepared.order[prepared.answerIndex]], this.language);
              return `
                <details class="review-row ${ok ? 'is-ok' : 'is-bad'}">
                  <summary>
                    <span class="review-mark">${ok ? svgIcon(ICONS.check).outerHTML : svgIcon(ICONS.close).outerHTML}</span>
                    <span class="review-q">${loc(q.question, this.language)}</span>
                    <span class="review-idx">${String(i + 1).padStart(2, '0')}</span>
                  </summary>
                  <div class="review-body">
                    <p><span>${copy.yourAnswer}</span>${yourText}</p>
                    ${ok ? '' : `<p><span>${copy.rightAnswer}</span>${rightText}</p>`}
                    <p class="review-explain"><span>${copy.why}</span>${loc(q.explanation, this.language)}</p>
                  </div>
                </details>`;
            })
            .join('')}
        </div>
      </div>
    `;

    this.wire('test:retry', '[data-celly="retry"]', () => {
      const rng = makeRng(Date.now() >>> 0);
      this.startMcq(shuffled(state.questions, rng), state.key, state.title);
    });
    this.wire('test:home', '[data-celly="home"]', () => this.returnHome());
  }

  // ------------------------------------------------------------------ flashcards

  private startFlash(ids: string[]): void {
    const order = this.leitner.order(ids);
    this.flash = { order, index: 0, revealed: false, results: [], missed: [] };
    this.view = 'flash';
    this.render();
  }

  private renderFlash(): void {
    const state = this.flash;
    if (!state || !state.order.length) {
      this.view = 'home';
      this.render();
      return;
    }
    const copy = this.copy();
    const id = state.order[state.index];
    const card = FLASHCARDS.find((f) => f.id === id);
    if (!card) {
      this.view = 'home';
      this.render();
      return;
    }
    const box = this.leitner.get(id).box;
    const progress = (state.index + (state.revealed ? 0.5 : 0)) / state.order.length;

    this.body.innerHTML = `
      <div class="test-top">
        <button class="icon-btn" type="button" data-celly="home" aria-label="${copy.allTests}">
          ${svgIcon(ICONS.arrowLeft).outerHTML}
        </button>
        <div class="test-top-title">
          <span class="eyebrow">${copy.flash}</span>
          <div class="test-progress"><i style="width:${progress * 100}%"></i></div>
        </div>
        <span class="test-count">${state.index + 1} / ${state.order.length}</span>
      </div>

      <div class="flash-meta">
        <span>${copy.card} ${state.index + 1}</span>
        <span class="box-pips" aria-label="Leitner box ${box}">
          ${[1, 2, 3, 4, 5].map((b) => `<i class="${b <= box ? 'is-on' : ''}"></i>`).join('')}
        </span>
      </div>

      <button class="flashcard ${state.revealed ? 'is-revealed' : ''}" type="button" data-celly="flip">
        <span class="flash-inner">
          <span class="flash-face flash-front">
            <span class="eyebrow">${copy.question}</span>
            <b>${loc(card.front, this.language)}</b>
            <span class="flash-tap">${svgIcon(ICONS.hand).outerHTML}${copy.flipHint}</span>
          </span>
          <span class="flash-face flash-back">
            <span class="eyebrow">${copy.rightAnswer}</span>
            <span class="flash-prompt">${loc(card.front, this.language)}</span>
            <span class="flash-answer">${loc(card.back, this.language)}</span>
          </span>
        </span>
      </button>

      ${
        state.revealed
          ? `<div class="flash-actions">
               <button class="btn ghost danger" type="button" data-celly="miss">
                 ${svgIcon(ICONS.close).outerHTML}<span>${copy.miss}</span>
               </button>
               <button class="btn primary" type="button" data-celly="knew">
                 ${svgIcon(ICONS.check).outerHTML}<span>${copy.knew}</span>
               </button>
             </div>
             <p class="flash-hint">${copy.swipeHint}</p>`
          : `<div class="flash-actions">
               <button class="btn primary wide" type="button" data-celly="flip-btn">
                 <span>${copy.reveal}</span>${svgIcon(ICONS.eye).outerHTML}
               </button>
             </div>`
      }
    `;

    this.wire('test:home', '[data-celly="home"]', () => this.returnHome());
    this.wire('test:flip', '[data-celly="flip"]', () => this.revealCard());
    if (state.revealed) {
      this.wire('test:knew', '[data-celly="knew"]', () => this.gradeCard(true));
      this.wire('test:miss', '[data-celly="miss"]', () => this.gradeCard(false));
    } else {
      this.wire('test:flip-btn', '[data-celly="flip-btn"]', () => this.revealCard());
    }
  }

  private revealCard(): void {
    if (!this.flash || this.flash.revealed) return;
    this.flash.revealed = true;
    this.render();
  }

  private swipeCard(forward: boolean): void {
    if (!this.flash) return;
    if (!this.flash.revealed) {
      this.revealCard();
      return;
    }
    this.gradeCard(forward);
  }

  private gradeCard(correct: boolean): void {
    const state = this.flash;
    if (!state) return;
    const id = state.order[state.index];
    this.leitner.answer(id, correct);
    state.results.push(correct);
    if (!correct) state.missed.push(id);
    if (state.index >= state.order.length - 1) {
      this.lastMissed = [...state.missed];
      this.view = 'flash-results';
    } else {
      state.index += 1;
      state.revealed = false;
    }
    this.render();
  }

  private renderFlashResults(): void {
    const state = this.flash;
    if (!state) {
      this.view = 'home';
      this.render();
      return;
    }
    const copy = this.copy();
    const known = state.results.filter(Boolean).length;
    const missed = state.results.length - known;
    const ratio = state.results.length ? known / state.results.length : 0;

    this.body.innerHTML = `
      <div class="test-top">
        <button class="icon-btn" type="button" data-celly="home" aria-label="${copy.allTests}">
          ${svgIcon(ICONS.arrowLeft).outerHTML}
        </button>
        <div class="test-top-title"><span class="eyebrow">${copy.flash}</span></div>
        <span class="test-count">${copy.score}</span>
      </div>
      <div class="results-head">
        <div class="score-ring" style="--p:${ratio.toFixed(3)};--grade:#a78bfa">
          <div><b>${Math.round(ratio * 100)}<small>%</small></b><span>${known} / ${state.results.length}</span></div>
        </div>
        <div class="results-copy">
          <span class="eyebrow">${copy.done}</span>
          <h2>${known} ${copy.known.toLowerCase()} · ${missed} ${copy.missed.toLowerCase()}</h2>
          <p>${missed === 0 ? copy.noMissed : copy.swipeHint}</p>
          <div class="results-actions">
            <button class="btn primary" type="button" data-celly="repeat"><span>${copy.retry}</span>${svgIcon(ICONS.rotate).outerHTML}</button>
            ${
              this.lastMissed.length
                ? `<button class="btn ghost" type="button" data-celly="review"><span>${copy.reviewMissed}</span></button>`
                : ''
            }
            <button class="btn ghost" type="button" data-celly="home"><span>${copy.allTests}</span></button>
          </div>
        </div>
      </div>
    `;

    this.wire('test:home', '[data-celly="home"]', () => this.returnHome());
    this.wire('test:repeat', '[data-celly="repeat"]', () => this.startFlash(FLASHCARDS.map((f) => f.id)));
    if (this.lastMissed.length) {
      this.wire('test:review', '[data-celly="review"]', () => this.startFlash(this.lastMissed));
    }
  }

  // ---------------------------------------------------------------------- wiring

  private wire(id: string, selector: string, handler: () => void): void {
    const nodes = this.body.querySelectorAll<HTMLElement>(selector);
    nodes.forEach((node, index) => {
      node.addEventListener('click', handler);
      this.unregister.push(this.ctx.registry.register(nodes.length > 1 ? `${id}:${index}` : id, node, handler));
    });
  }

  private clearButtons(): void {
    for (const fn of this.unregister) fn();
    this.unregister.length = 0;
  }
}
