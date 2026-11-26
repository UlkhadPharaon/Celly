/**
 * Persistence for the research study: one in-progress session plus an archive of finished ones.
 *
 * The same defensive pattern as `core/settings.ts` applies — anything read back out of
 * localStorage is re-validated field by field, so a corrupted or newer payload degrades to a
 * fresh session instead of crashing the app or poisoning the dataset.
 */

import type { Language } from '../types';
import { INTERACTION_MODES, type InteractionMode, type ModeAggregate, type QuizAnswer, type StudySession, type SurveyAnswers } from './types';

export const SESSION_KEY = 'celly:v03:session';
export const ARCHIVE_KEY = 'celly:v03:archive';
/** Bumped whenever a stored field changes meaning. */
export const SESSION_VERSION = 1;

/* ------------------------------------------------------------------ pure helpers */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Anonymous participant code. Visually unambiguous alphabet, no look-alike glyphs. */
export function participantCode(): string {
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `CL-${out}`;
}

export function emptySession(language: Language, now = Date.now()): StudySession {
  return {
    version: SESSION_VERSION,
    participantId: participantCode(),
    startedAt: now,
    endedAt: null,
    language,
    mode: null,
    tourCompleted: false,
    readingSeconds: 0,
    quiz: [],
    quizTotal: 0,
    survey: null
  };
}

const PREFERENCE_ORDER = ['much-less', 'less', 'same', 'more', 'much-more'] as const;

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function num(value: unknown, fallback: number, lo: number, hi: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(hi, Math.max(lo, value));
}

export function sanitizeMode(input: unknown): InteractionMode | null {
  return typeof input === 'string' && (INTERACTION_MODES as readonly string[]).includes(input)
    ? (input as InteractionMode)
    : null;
}

export function sanitizeSurvey(input: unknown): SurveyAnswers | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const preference = PREFERENCE_ORDER.find((p) => p === raw.preference);
  if (!preference) return null;
  return {
    difficulty: Math.round(num(raw.difficulty, 3, 1, 5)),
    difference: Math.round(num(raw.difference, 3, 1, 5)),
    effectiveness: Math.round(num(raw.effectiveness, 3, 1, 5)),
    preference,
    recommend: Math.round(num(raw.recommend, 5, 0, 10)),
    comment: typeof raw.comment === 'string' ? raw.comment.slice(0, 2000) : ''
  };
}

export function sanitizeQuiz(input: unknown): QuizAnswer[] {
  if (!Array.isArray(input)) return [];
  const out: QuizAnswer[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.questionId !== 'string' || typeof raw.correct !== 'boolean') continue;
    out.push({
      questionId: raw.questionId,
      correct: raw.correct,
      ms: num(raw.ms, 0, 0, 3600_000)
    });
  }
  return out;
}

/** Returns null for anything this build cannot trust (a newer schema always falls back). */
export function sanitizeSession(input: unknown): StudySession | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.version === 'number' && raw.version > SESSION_VERSION) return null;
  if (typeof raw.participantId !== 'string' || raw.participantId.length === 0) return null;
  return {
    version: SESSION_VERSION,
    participantId: raw.participantId.slice(0, 32),
    startedAt: num(raw.startedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    endedAt: typeof raw.endedAt === 'number' ? raw.endedAt : null,
    language: raw.language === 'fr' ? 'fr' : 'en',
    mode: sanitizeMode(raw.mode),
    tourCompleted: bool(raw.tourCompleted, false),
    readingSeconds: num(raw.readingSeconds, 0, 0, 86_400_000),
    quiz: sanitizeQuiz(raw.quiz),
    quizTotal: Math.round(num(raw.quizTotal, 0, 0, 1000)),
    survey: sanitizeSurvey(raw.survey)
  };
}

export function sanitizeArchive(input: unknown): StudySession[] {
  if (!Array.isArray(input)) return [];
  return input.map(sanitizeSession).filter((s): s is StudySession => s !== null).slice(0, 500);
}

/** Correct answers / total asked, or null when nothing was asked. */
export function quizRatio(session: StudySession): number | null {
  const total = session.quizTotal > 0 ? session.quizTotal : session.quiz.length;
  if (total <= 0) return null;
  return session.quiz.filter((a) => a.correct).length / total;
}

/* ------------------------------------------------------------------ aggregation */

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round(value: number | null, digits = 2): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

/** Per-mode rollup. The comparison the study exists to make. */
export function aggregate(sessions: readonly StudySession[]): ModeAggregate[] {
  const modes: InteractionMode[] = [...INTERACTION_MODES];
  return modes.map((mode) => {
    const own = sessions.filter((s) => s.mode === mode);
    const finished = own.filter((s) => s.survey !== null || s.quiz.length > 0);
    const ratios = own.map(quizRatio).filter((r): r is number => r !== null);
    const surveys = own.map((s) => s.survey).filter((s): s is SurveyAnswers => s !== null);
    const preferenceCounts: ModeAggregate['preferenceCounts'] = {
      'much-less': 0,
      less: 0,
      same: 0,
      more: 0,
      'much-more': 0
    };
    for (const survey of surveys) preferenceCounts[survey.preference] += 1;
    const withReading = own.filter((s) => s.readingSeconds > 0);
    return {
      mode,
      participants: own.length,
      completed: finished.length,
      meanQuizRatio: round(mean(ratios)),
      meanReadingSeconds: round(
        mean(withReading.map((s) => s.readingSeconds)),
        0
      ),
      meanDifficulty: round(mean(surveys.map((s) => s.difficulty))),
      meanDifference: round(mean(surveys.map((s) => s.difference))),
      meanEffectiveness: round(mean(surveys.map((s) => s.effectiveness))),
      meanRecommend: round(mean(surveys.map((s) => s.recommend)), 1),
      preferenceCounts
    };
  });
}

/* ---------------------------------------------------------------------- exports */

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  // Quotes the cell, and doubles any quote inside it. Newlines are kept quoted so the CSV stays
  // a valid two-dimensional document even with a multi-line free-text answer.
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

/** ISO-8601 UTC instant, so spreadsheets parse it without locale help. */
function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** One row per participant: the dataset for the group comparison. */
export function sessionsToCsv(sessions: readonly StudySession[]): string {
  const head = csvRow([
    'participant_id',
    'mode',
    'language',
    'started_at',
    'ended_at',
    'duration_seconds',
    'reading_seconds',
    'tour_completed',
    'quiz_correct',
    'quiz_total',
    'quiz_ratio',
    'quiz_seconds',
    'difficulty_1_easy_5_hard',
    'difference_1_same_5_different',
    'effectiveness_1_worse_5_better',
    'preference',
    'recommend_0_10',
    'comment'
  ]);
  const rows = sessions.map((s) => {
    const ratio = quizRatio(s);
    const quizMs = s.quiz.reduce((a, q) => a + q.ms, 0);
    return csvRow([
      s.participantId,
      s.mode ?? '',
      s.language,
      iso(s.startedAt),
      s.endedAt === null ? '' : iso(s.endedAt),
      s.endedAt === null ? '' : Math.round((s.endedAt - s.startedAt) / 1000),
      Math.round(s.readingSeconds),
      s.tourCompleted,
      s.quiz.filter((q) => q.correct).length,
      s.quizTotal,
      ratio === null ? '' : Number(ratio.toFixed(3)),
      Math.round(quizMs / 1000),
      s.survey?.difficulty ?? '',
      s.survey?.difference ?? '',
      s.survey?.effectiveness ?? '',
      s.survey?.preference ?? '',
      s.survey?.recommend ?? '',
      s.survey?.comment.replace(/\s+/g, ' ').trim() ?? ''
    ]);
  });
  return [head, ...rows].join('\r\n');
}

/** One row per answered question, so item-level difficulty can be computed per mode. */
export function answersToCsv(sessions: readonly StudySession[]): string {
  const head = csvRow(['participant_id', 'mode', 'question_id', 'correct', 'seconds']);
  const rows: string[] = [];
  for (const s of sessions) {
    for (const answer of s.quiz) {
      rows.push(
        csvRow([
          s.participantId,
          s.mode ?? '',
          answer.questionId,
          answer.correct,
          Number((answer.ms / 1000).toFixed(2))
        ])
      );
    }
  }
  return [head, ...rows].join('\r\n');
}

export function exportPayload(sessions: readonly StudySession[]): string {
  return JSON.stringify(
    {
      exportedAt: iso(Date.now()),
      schema: SESSION_VERSION,
      participants: sessions.length,
      aggregate: aggregate(sessions),
      sessions
    },
    null,
    2
  );
}

/* ----------------------------------------------------------------------- storage */

/**
 * The live store. Nothing here throws: a disabled localStorage (private mode) simply means the
 * study runs without persistence, which is better than failing the session.
 */
export class StudyStore {
  private session: StudySession | null;
  private archive: StudySession[];

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = safeStorage()) {
    this.session = null;
    this.archive = [];
    this.load();
  }

  private load(): void {
    if (!this.storage) return;
    try {
      this.session = sanitizeSession(readJSON(this.storage, SESSION_KEY));
      this.archive = sanitizeArchive(readJSON(this.storage, ARCHIVE_KEY));
    } catch {
      this.session = null;
      this.archive = [];
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      if (this.session) this.storage.setItem(SESSION_KEY, JSON.stringify(this.session));
      else this.storage.removeItem(SESSION_KEY);
      this.storage.setItem(ARCHIVE_KEY, JSON.stringify(this.archive));
    } catch {
      // Storage full or disabled: keep running with the in-memory copy.
    }
  }

  /** The session in progress, starting one if the device has none (or a finished one). */
  current(language: Language): StudySession {
    if (!this.session || this.session.endedAt !== null) {
      this.session = emptySession(language);
      this.persist();
    }
    return this.session;
  }

  get hasSession(): boolean {
    return this.session !== null && this.session.endedAt === null;
  }

  get mode(): InteractionMode | null {
    return this.session?.mode ?? null;
  }

  get tourCompleted(): boolean {
    return this.session?.tourCompleted ?? false;
  }

  patch(patch: Partial<StudySession>): StudySession | null {
    if (!this.session) return null;
    this.session = { ...this.session, ...patch };
    this.persist();
    return this.session;
  }

  setMode(mode: InteractionMode): void {
    this.patch({ mode });
  }

  completeTour(): void {
    this.patch({ tourCompleted: true });
  }

  addReading(seconds: number): void {
    if (!this.session || seconds <= 0) return;
    this.patch({ readingSeconds: this.session.readingSeconds + seconds });
  }

  recordQuiz(answers: readonly QuizAnswer[], total: number): void {
    this.patch({ quiz: [...answers], quizTotal: total });
  }

  recordSurvey(survey: SurveyAnswers): void {
    this.patch({ survey });
  }

  /** Close the session and archive it. Returns the archived copy, or null when nothing closed. */
  finish(now = Date.now()): StudySession | null {
    if (!this.session) return null;
    const closed: StudySession = { ...this.session, endedAt: this.session.endedAt ?? now };
    // A closed session is never re-armed in place: a repeat participant gets a fresh code.
    this.session = null;
    this.archive = [...this.archive, closed].slice(-500);
    this.persist();
    return closed;
  }

  /** All sessions on this device: archive first, then the one still in progress. */
  all(): StudySession[] {
    return [...this.archive, ...(this.session ? [this.session] : [])];
  }

  exportCsv(): string {
    return sessionsToCsv(this.all());
  }

  exportAnswersCsv(): string {
    return answersToCsv(this.all());
  }

  exportJson(): string {
    return exportPayload(this.all());
  }

  clear(): void {
    this.session = null;
    this.archive = [];
    if (!this.storage) return;
    try {
      this.storage.removeItem(SESSION_KEY);
      this.storage.removeItem(ARCHIVE_KEY);
    } catch {
      // Nothing to clear.
    }
  }
}

function readJSON(storage: Pick<Storage, 'getItem'>, key: string): unknown {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    // Touch it once: Safari private mode defines localStorage but throws on write.
    localStorage.setItem('celly:probe', '1');
    localStorage.removeItem('celly:probe');
    return localStorage;
  } catch {
    return null;
  }
}