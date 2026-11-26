/**
 * Researcher view: every participant recorded on this device, the per-mode comparison, and the
 * exports. This is the screen that turns the app into an instrument — it is meant for whoever
 * runs the study, not for the participant.
 */

import type { ButtonRegistry } from './buttons';
import type { Language } from '../types';
import { aggregate, quizRatio, type StudyStore } from '../study/store';
import { MODE_COPY } from '../study/modeCopy';
import { downloadText } from '../study/download';
import type { StudySession } from '../study/types';
import { escapeHtml, svgIcon, ICONS } from './dom';

export const COPY = {
  en: {
    kicker: 'Celly · study data',
    title: 'Participants and comparison',
    lead: 'Anonymous profiles stored on this device. Export the CSV to compare the three conditions in any spreadsheet.',
    empty: 'No participant has finished a session on this device yet.',
    tableHead: ['Participant', 'Mode', 'Date', 'Quiz', 'Hard', 'Different', 'Effective', 'Prefers more', 'Recommend'],
    compare: 'Comparison by mode',
    compareHead: ['Mode', 'n', 'Quiz', 'Reading', 'Hard', 'Different', 'Effective', 'Recommend'],
    none: '—',
    exportCsv: 'Export participants (CSV)',
    exportAnswers: 'Export answers (CSV)',
    exportJson: 'Export everything (JSON)',
    copy: 'Copy JSON',
    copied: 'Copied to the clipboard',
    clear: 'Delete all study data',
    confirm: 'Click again to delete everything',
    close: 'Close',
    statusInProgress: 'in progress',
    statusDone: 'complete',
    minutes: (s: number) => `${Math.round(s / 60)} min`,
    note: 'A profile is complete once the survey is submitted. In-progress rows are included in the export and flagged by the missing end date.',
    notFinished: 'not finished'
  },
  fr: {
    kicker: 'Celly · données de l’étude',
    title: 'Participants et comparaison',
    lead: 'Profils anonymes enregistrés sur cet appareil. Exportez le CSV pour comparer les trois conditions dans un tableur.',
    empty: 'Aucun participant n’a encore terminé de session sur cet appareil.',
    tableHead: ['Participant', 'Mode', 'Date', 'Quiz', 'Difficile', 'Différent', 'Efficace', 'Préfère plus', 'Recommande'],
    compare: 'Comparaison par mode',
    compareHead: ['Mode', 'n', 'Quiz', 'Lecture', 'Difficile', 'Différent', 'Efficace', 'Recommande'],
    none: '—',
    exportCsv: 'Exporter les participants (CSV)',
    exportAnswers: 'Exporter les réponses (CSV)',
    exportJson: 'Tout exporter (JSON)',
    copy: 'Copier le JSON',
    copied: 'Copié dans le presse-papiers',
    clear: 'Supprimer toutes les données',
    confirm: 'Cliquez encore pour tout supprimer',
    close: 'Fermer',
    statusInProgress: 'en cours',
    statusDone: 'terminé',
    minutes: (s: number) => `${Math.round(s / 60)} min`,
    note: 'Un profil est complet une fois le questionnaire envoyé. Les lignes en cours figurent dans l’export et se repèrent à l’absence de date de fin.',
    notFinished: 'non terminé'
  }
} as const;

const PREFERENCE_LABEL: Record<string, { en: string; fr: string }> = {
  'much-less': { en: 'much less', fr: 'bien moins' },
  less: { en: 'less', fr: 'moins' },
  same: { en: 'same', fr: 'pareil' },
  more: { en: 'more', fr: 'plus' },
  'much-more': { en: 'much more', fr: 'bien plus' }
};

export interface ResearchPanelOptions {
  study: StudyStore;
  language: Language;
}

export class ResearchPanel {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private language: Language;
  private confirmingClear = false;

  constructor(
    private readonly registry: ButtonRegistry,
    private readonly opts: ResearchPanelOptions
  ) {
    this.language = opts.language;
    this.root = document.createElement('div');
    this.root.className = 'research-panel';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'celly-research-title');

    this.body = document.createElement('div');
    this.body.className = 'research-card';
    this.root.append(this.body);

    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.close();
    });
    document.addEventListener('keydown', this.onKeyDown);
    this.render();
  }

  get isOpen(): boolean {
    return this.root.classList.contains('is-open');
  }

  open(): void {
    this.confirmingClear = false;
    this.root.classList.add('is-open');
    this.render();
    requestAnimationFrame(() => this.body.querySelector<HTMLElement>('button')?.focus());
  }

  close(): void {
    this.root.classList.remove('is-open');
  }

  setLanguage(language: Language): void {
    this.language = language;
    if (this.isOpen) this.render();
  }

  private render(): void {
    const ui = COPY[this.language];
    const sessions = this.opts.study.all();
    const modes = aggregate(sessions);
    const rows = sessions.map((session) => this.row(session, ui));
    const compareRows = modes
      .filter((mode) => mode.participants > 0)
      .map(
        (mode) => `
        <tr>
          <td>${escapeHtml(MODE_COPY[this.language][mode.mode].title)}</td>
          <td>${mode.participants}</td>
          <td>${this.percent(mode.meanQuizRatio)}</td>
          <td>${mode.meanReadingSeconds === null ? ui.none : ui.minutes(mode.meanReadingSeconds)}</td>
          <td>${this.num(mode.meanDifficulty)}</td>
          <td>${this.num(mode.meanDifference)}</td>
          <td>${this.num(mode.meanEffectiveness)}</td>
          <td>${this.num(mode.meanRecommend)}</td>
        </tr>`
      )
      .join('');

    this.body.innerHTML = `
      <header class="research-head">
        <span class="eyebrow">${ui.kicker}</span>
        <h2 id="celly-research-title">${ui.title}</h2>
        <p>${ui.lead}</p>
        <button class="icon-btn research-close" type="button" data-research="close" aria-label="${ui.close}">${svgIcon(ICONS.close).outerHTML}</button>
      </header>

      ${
        sessions.length === 0
          ? `<p class="research-empty">${ui.empty}</p>`
          : `<div class="research-scroll">
              <table class="research-table">
                <thead><tr>${ui.tableHead.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
                <tbody>${rows.join('')}</tbody>
              </table>
            </div>`
      }

      ${
        compareRows
          ? `<h3 class="research-subtitle">${ui.compare}</h3>
             <div class="research-scroll">
               <table class="research-table is-compare">
                 <thead><tr>${ui.compareHead.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
                 <tbody>${compareRows}</tbody>
               </table>
             </div>`
          : ''
      }

      <div class="research-actions">
        <button class="btn primary small" type="button" data-research="csv">${ui.exportCsv}</button>
        <button class="btn ghost small" type="button" data-research="answers">${ui.exportAnswers}</button>
        <button class="btn ghost small" type="button" data-research="json">${ui.exportJson}</button>
        <button class="btn ghost small" type="button" data-research="copy">${ui.copy}</button>
        <span class="research-spacer"></span>
        <button class="btn danger small" type="button" data-research="clear">${this.confirmingClear ? ui.confirm : ui.clear}</button>
      </div>
      <p class="research-note">${ui.note}</p>
      <p class="research-status" role="status" aria-live="polite"></p>
    `;

    const actions: Record<string, () => void> = {
      close: () => this.close(),
      csv: () => downloadText('celly-study.csv', this.opts.study.exportCsv(), 'text/csv'),
      answers: () => downloadText('celly-study-answers.csv', this.opts.study.exportAnswersCsv(), 'text/csv'),
      json: () => downloadText('celly-study.json', this.opts.study.exportJson(), 'application/json'),
      copy: () => void this.copyJson(),
      clear: () => {
        if (!this.confirmingClear) {
          this.confirmingClear = true;
          this.render();
          return;
        }
        this.opts.study.clear();
        this.confirmingClear = false;
        this.render();
      }
    };

    for (const btn of this.body.querySelectorAll<HTMLButtonElement>('[data-research]')) {
      const handler = actions[btn.dataset.research as string];
      if (!handler) continue;
      btn.addEventListener('click', handler);
      this.registry.register(`research:${btn.dataset.research as string}`, btn, handler);
    }
    requestAnimationFrame(() => this.registry.refreshAll());
  }

  private row(
    session: StudySession,
    ui: { none: string; statusInProgress: string; statusDone: string }
  ): string {
    const survey = session.survey;
    const ratio = quizRatio(session);
    const date = new Date(session.startedAt).toLocaleDateString(this.language === 'fr' ? 'fr-FR' : 'en-GB');
    const mode = session.mode ? MODE_COPY[this.language][session.mode].title : ui.none;
    return `<tr>
      <td class="research-code">${escapeHtml(session.participantId)}</td>
      <td>${escapeHtml(mode)}</td>
      <td>${escapeHtml(date)}<br><small>${session.endedAt === null ? ui.statusInProgress : ui.statusDone}</small></td>
      <td>${this.percent(ratio)}</td>
      <td>${survey ? survey.difficulty : ui.none}</td>
      <td>${survey ? survey.difference : ui.none}</td>
      <td>${survey ? survey.effectiveness : ui.none}</td>
      <td>${survey ? PREFERENCE_LABEL[survey.preference][this.language] : ui.none}</td>
      <td>${survey ? survey.recommend : ui.none}</td>
    </tr>`;
  }

  private percent(ratio: number | null): string {
    return ratio === null ? COPY[this.language].none : `${Math.round(ratio * 100)}%`;
  }

  private num(value: number | null): string {
    return value === null ? COPY[this.language].none : String(value);
  }

  private async copyJson(): Promise<void> {
    const status = this.body.querySelector<HTMLElement>('.research-status');
    try {
      await navigator.clipboard.writeText(this.opts.study.exportJson());
      if (status) status.textContent = COPY[this.language].copied;
    } catch {
      if (status) status.textContent = '';
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen || event.key !== 'Escape') return;
    event.preventDefault();
    this.close();
  };
}