/**
 * Study-instrument types (research build).
 *
 * One participant produces exactly one `StudySession`: the interaction mode they picked, what
 * they read, what they answered on the quiz, and how they rated the experience. Sessions are
 * kept locally on the device and exported as JSON/CSV so the results of several participants
 * can be compared outside the app.
 *
 * Kept DOM-free so the whole module stays unit-testable in Node.
 */

import type { Language } from '../types';

/** How a participant drives the interface. */
export type InteractionMode = 'hands' | 'mouse' | 'text';

/** The five-point "would you study more like this" answer. */
export type Preference = 'much-less' | 'less' | 'same' | 'more' | 'much-more';

export const INTERACTION_MODES: readonly InteractionMode[] = ['hands', 'mouse', 'text'];

/** One answered question of the post-reading quiz. */
export interface QuizAnswer {
  questionId: string;
  correct: boolean;
  /** Milliseconds spent on the question, for a speed dimension next to accuracy. */
  ms: number;
}

/**
 * Post-experience questionnaire. Every numeric item is a 1..5 Likert scale, worded so that 5 is
 * always the "better" end (see `LIKERT_LABELS`), except `difficulty`, where 5 means "very hard".
 */
export interface SurveyAnswers {
  /** 1 = very easy … 5 = very hard. */
  difficulty: number;
  /** 1 = exactly like my usual studying … 5 = completely different from it. */
  difference: number;
  /** 1 = much worse than my usual way … 5 = much better than my usual way. */
  effectiveness: number;
  /** Would you study more like this? Only two anchors are labelled; the scale is 5 points. */
  preference: Preference;
  /** 0..10 — "would you recommend this to a classmate". */
  recommend: number;
  /** Free text. */
  comment: string;
}

export interface StudySession {
  /** Schema stamp; a payload from a newer build is discarded rather than merged. */
  version: number;
  /** Anonymous participant code, e.g. `CL-7Q4M2K`. */
  participantId: string;
  startedAt: number;
  endedAt: number | null;
  language: Language;
  mode: InteractionMode | null;
  /** True once the guided tour of the interface has been watched to the end. */
  tourCompleted: boolean;
  /** Cumulative seconds spent with reading material on screen (text mode, knowledge pages). */
  readingSeconds: number;
  quiz: QuizAnswer[];
  /** Questions served in this session — the denominator even when some were skipped. */
  quizTotal: number;
  survey: SurveyAnswers | null;
}

/** Aggregated view of one interaction mode, for the comparison panel. */
export interface ModeAggregate {
  mode: InteractionMode;
  participants: number;
  completed: number;
  meanQuizRatio: number | null;
  meanReadingSeconds: number | null;
  meanDifficulty: number | null;
  meanDifference: number | null;
  meanEffectiveness: number | null;
  meanRecommend: number | null;
  preferenceCounts: Record<SurveyAnswers['preference'], number>;
}

export const SURVEY_VERSION = 1;

/** The five points of the preference item, in scale order. */
export const PREFERENCE_SCALE = ['much-less', 'less', 'same', 'more', 'much-more'] as const;

/** Likert anchors. One entry per scale point; the UI labels the ends only by default. */
export const LIKERT_LABELS = {
  en: {
    1: 'not at all',
    5: 'completely'
  },
  fr: {
    1: 'pas du tout',
    5: 'tout à fait'
  }
} as const;