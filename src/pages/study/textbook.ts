/**
 * The text-only surface: a textbook page.
 *
 * No 3D, no camera, no colour-coded blobs. Chapters, a table of contents, figures described in
 * words and a glossary — the control condition of the study. The reading material is the same
 * data the 3D lab shows, so the only thing that differs between groups is the presentation.
 */

import type { ButtonRegistry } from '../../ui/buttons';
import type { Language } from '../../types';
import { CHAPTERS, GLOSSARY, readingMinutes } from './chapters';
import { KNOWLEDGE_NODES, loc, locList } from '../../data/catalog';
import { escapeHtml } from '../../ui/dom';

export const COPY = {
  en: {
    kicker: 'Celly · study · reading',
    title: 'The cell',
    subtitle: 'A short course in eight chapters',
    lead: 'Read all eight chapters, then take the quiz at the end of the page. Six minutes to read, then the same questions everyone answers.',
    minutes: (n: number) => `${n} min of reading`,
    mode: 'Reading only — no 3D, no camera',
    contents: 'Contents',
    glossary: 'Glossary',
    keyIdea: 'Worth remembering',
    structure: 'Structure',
    does: 'What it does',
    related: 'Related',
    figure: 'Figure',
    start: 'Start the quiz',
    startNote: 'The quiz is the same for everyone: 10 questions, no score shown until the end.',
    quizTitle: 'The end of the reading',
    glossaryTitle: 'Glossary of the fifteen organelles',
    progress: 'Reading progress',
    of: 'of'
  },
  fr: {
    kicker: 'Celly · étude · lecture',
    title: 'La cellule',
    subtitle: 'Un petit cours en huit chapitres',
    lead: 'Lisez les huit chapitres, puis passez le quiz en bas de page. Six minutes de lecture, puis les mêmes questions pour tout le monde.',
    minutes: (n: number) => `${n} min de lecture`,
    mode: 'Lecture seule — pas de 3D, pas de caméra',
    contents: 'Sommaire',
    glossary: 'Glossaire',
    keyIdea: 'À retenir',
    structure: 'Structure',
    does: 'Ce qu’il fait',
    related: 'En lien',
    figure: 'Figure',
    start: 'Commencer le quiz',
    startNote: 'Le quiz est le même pour tout le monde : 10 questions, aucun score affiché avant la fin.',
    quizTitle: 'Fin de la lecture',
    glossaryTitle: 'Glossaire des quinze organites',
    progress: 'Progression de lecture',
    of: 'sur'
  }
} as const;

export interface TextbookOptions {
  language: Language;
  /** Reading time is accumulated in seconds and pushed to the store as it grows. */
  onReading: (seconds: number) => void;
  onStartQuiz: () => void;
}

export class TextbookPage {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly toc: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly progressLabel: HTMLElement;
  private language: Language;
  private reading = 0;
  private timer = 0;
  private unregister: Array<() => void> = [];
  private readonly onScroll = (): void => this.sync();

  constructor(
    private readonly registry: ButtonRegistry,
    private readonly opts: TextbookOptions
  ) {
    this.language = opts.language;
    const ui = this.ui;
    const minutes = readingMinutes();

    this.root = document.createElement('section');
    this.root.className = 'textbook';

    const sheet = document.createElement('div');
    sheet.className = 'textbook-sheet';

    const head = document.createElement('header');
    head.className = 'textbook-head';
    head.innerHTML = `
      <span class="eyebrow">${escapeHtml(ui.kicker)}</span>
      <h1>${escapeHtml(ui.title)}</h1>
      <p class="textbook-subtitle">${escapeHtml(ui.subtitle)}</p>
      <p class="textbook-lead">${escapeHtml(ui.lead)}</p>
      <p class="textbook-mode" data-tour="text-mode">${escapeHtml(ui.mode)} · ${escapeHtml(ui.minutes(minutes))}</p>
      <div class="textbook-progress" data-tour="text-progress" role="progressbar" aria-label="${escapeHtml(ui.progress)}">
        <i></i>
        <span class="textbook-progress-label"></span>
      </div>
    `;
    this.progressFill = head.querySelector('.textbook-progress i') as HTMLElement;
    this.progressLabel = head.querySelector('.textbook-progress-label') as HTMLElement;

    const columns = document.createElement('div');
    columns.className = 'textbook-columns';

    this.toc = document.createElement('nav');
    this.toc.className = 'textbook-toc';
    this.toc.dataset.tour = 'text-toc';
    this.toc.setAttribute('aria-label', ui.contents);

    this.body = document.createElement('article');
    this.body.className = 'textbook-body';
    this.body.dataset.tour = 'text-body';

    columns.append(this.toc, this.body);
    sheet.append(head, columns);
    this.root.append(sheet);
    this.render();
  }

  /** Start the reading clock and the scroll tracking. */
  start(): void {
    this.timer = window.setInterval(() => {
      if (document.hidden) return;
      this.reading += 1;
    }, 1000);
    window.addEventListener('scroll', this.onScroll, true);
    this.sync();
  }

  dispose(): void {
    window.clearInterval(this.timer);
    window.removeEventListener('scroll', this.onScroll, true);
    this.teardown();
    this.root.remove();
  }

  get readingSeconds(): number {
    return this.reading;
  }

  private get ui(): (typeof COPY)[Language] {
    return COPY[this.language];
  }

  setLanguage(language: Language): void {
    this.language = language;
    this.render();
  }

  private render(): void {
    const ui = this.ui;
    this.teardown();

    // ------------------------------------------------------------------- contents
    this.toc.innerHTML = `
      <span class="eyebrow">${escapeHtml(ui.contents)}</span>
      <ol class="textbook-toc-list">
        ${CHAPTERS.map(
          (chapter) => `
          <li>
            <a href="#tb-${chapter.id}" data-toc="${chapter.id}">
              <i>${chapter.number}</i>
              <span>${escapeHtml(loc(chapter.title, this.language))}</span>
            </a>
          </li>`
        ).join('')}
      </ol>`;

    // -------------------------------------------------------------------- chapters
    this.body.innerHTML = CHAPTERS.map((chapter) => this.chapterMarkup(chapter)).join('');

    // ------------------------------------------------------------- start the quiz
    const start = document.createElement('div');
    start.className = 'textbook-start';
    start.innerHTML = `
      <span class="eyebrow">${escapeHtml(ui.glossaryTitle)}</span>
      <h2>${escapeHtml(ui.quizTitle)}</h2>
      <p>${escapeHtml(ui.startNote)}</p>
      <p class="textbook-glossary">${GLOSSARY.map((item) => `<span><b>${escapeHtml(loc(item.term, this.language))}</b> ${escapeHtml(loc(item.definition, this.language))}</span>`).join('')}</p>
    `;
    const backTop = document.createElement('button');
    backTop.className = 'textbook-top';
    backTop.type = 'button';
    backTop.textContent = '↑';
    backTop.setAttribute('aria-label', 'Back to top');
    this.body.append(backTop);
    backTop.addEventListener('click', () => {
      this.root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const button = document.createElement('button');
    button.className = 'btn primary';
    button.type = 'button';
    button.dataset.celly = 'start-quiz';
    button.textContent = ui.start;
    const handler = (): void => this.opts?.onStartQuiz();
    button.addEventListener('click', handler);
    this.unregister.push(this.registry.register('study:start-quiz', button, handler));
    start.append(button);
    this.body.append(start);

    // Smooth scrolling and the active-chapter marker.
    for (const link of this.toc.querySelectorAll<HTMLAnchorElement>('[data-toc]')) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const target = this.body.querySelector(`#tb-${link.dataset.toc as string}`);
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    this.sync();
  }

  private chapterMarkup(chapter: (typeof CHAPTERS)[number]): string {
    const ui = this.ui;
    const related = (chapter.relatedNodes ?? [])
      .map((id) => KNOWLEDGE_NODES.find((node) => node.id === id))
      .filter((node): node is (typeof KNOWLEDGE_NODES)[number] => Boolean(node))
      .map((node) => `<li><b>${escapeHtml(loc(node.label, this.language))}</b> — ${escapeHtml(loc(node.summary, this.language))}</li>`)
      .join('');

    const figure = chapter.figure
      ? `<figure class="textbook-figure">
           <span class="textbook-figure-tag">${ui.figure} ${chapter.number}</span>
           <figcaption>${escapeHtml(loc(chapter.figure.caption, this.language))}</figcaption>
           <p>${escapeHtml(loc(chapter.figure.description, this.language))}</p>
         </figure>`
      : '';

    return `
      <section class="textbook-chapter" id="tb-${chapter.id}" data-chapter="${chapter.id}">
        <header class="textbook-chapter-head">
          <span class="textbook-chapter-number">${String(chapter.number).padStart(2, '0')}</span>
          <h2>${escapeHtml(loc(chapter.title, this.language))}</h2>
        </header>
        ${chapter.intro ? `<p class="textbook-intro">${escapeHtml(loc(chapter.intro, this.language))}</p>` : ''}
        ${chapter.entries.map((entry) => this.entryMarkup(entry)).join('')}
        ${figure}
        ${related ? `<aside class="textbook-related"><span class="eyebrow">${ui.related}</span><ul>${related}</ul></aside>` : ''}
      </section>`;
  }

  private entryMarkup(entry: (typeof CHAPTERS)[number]['entries'][number]): string {
    const ui = this.ui;
    return `
      <div class="textbook-entry">
        <h3 id="tb-entry-${entry.id}">${escapeHtml(loc(entry.name, this.language))}</h3>
        <p class="textbook-definition">${escapeHtml(loc(entry.definition, this.language))}</p>
        ${entry.structure.en || entry.structure.fr ? `<p class="textbook-structure"><b>${ui.structure}</b> ${escapeHtml(loc(entry.structure, this.language))}</p>` : ''}
        <h4>${ui.does}</h4>
        <ul class="textbook-functions">${locList(entry.functions, this.language).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        <p class="textbook-fact"><b>${ui.keyIdea}</b> ${escapeHtml(loc(entry.fact, this.language))}</p>
      </div>`;
  }

  /** Progress bar, active chapter in the contents, and the "glossary reached" flag. */
  private sync(): void {
    // The reading surface scrolls inside `.study-layer-body`, not on the layer itself; falling
    // back to the document keeps the bar working if the textbook is ever mounted standalone.
    const scroller =
      this.root.closest('.study-layer-body') ??
      this.root.closest('.study-layer') ??
      document.scrollingElement ??
      document.documentElement;
    const max = scroller.scrollHeight - scroller.clientHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / max)) : 0;
    this.progressFill.style.width = `${Math.round(ratio * 100)}%`;
    this.progressLabel.textContent = `${Math.round(ratio * 100)}%`;

    const chapters = [...this.body.querySelectorAll<HTMLElement>('[data-chapter]')];
    let active = chapters[0] ?? null;
    for (const chapter of chapters) {
      if (chapter.getBoundingClientRect().top <= 140) active = chapter;
    }
    if (active) {
      for (const link of this.toc.querySelectorAll<HTMLElement>('[data-toc]')) {
        link.classList.toggle('is-active', link.dataset.toc === active?.dataset.chapter);
      }
    }
  }

  private teardown(): void {
    for (const fn of this.unregister) fn();
    this.unregister = [];
  }
}