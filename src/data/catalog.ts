import type {
  Difficulty,
  Flashcard,
  KnowledgeNode,
  Language,
  Loc,
  LocList,
  OrganelleMeta,
  Question,
  QuestionnaireSet
} from '../types';
import organellesRaw from './organelles.json';
import knowledgeRaw from './knowledge.json';
import questionsRaw from './questions.json';

export const ORGANELLES = organellesRaw as unknown as OrganelleMeta[];
export const KNOWLEDGE_NODES = knowledgeRaw as unknown as KnowledgeNode[];
export const MCQS = questionsRaw.mcq as unknown as Question[];
export const FLASHCARDS = questionsRaw.flashcards as unknown as Flashcard[];
export const QUESTIONNAIRES = questionsRaw.questionnaires as unknown as QuestionnaireSet[];

export const ORGANELLE_BY_ID = new Map(ORGANELLES.map((o) => [o.id, o]));
export const KNOWLEDGE_BY_ID = new Map(KNOWLEDGE_NODES.map((n) => [n.id, n]));
export const MCQ_BY_ID = new Map(MCQS.map((q) => [q.id, q]));

export const DIFFICULTY_ORDER: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 };

export function loc(value: Loc | undefined | null, lang: Language): string {
  if (!value) return '';
  return lang === 'fr' ? (value.fr ?? value.en) : value.en;
}

export function locList(value: LocList | undefined | null, lang: Language): string[] {
  if (!value) return [];
  return lang === 'fr' ? (value.fr ?? value.en) : value.en;
}

/** Deterministic shuffle so a session is reproducible in tests but fresh per reload. */
export function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** MCQ choices are shuffled per session; the answer travels with its text. */
export function prepareQuestion(q: Question, rng: () => number): { order: number[]; answerIndex: number } {
  const order = shuffled(
    q.options.map((_, i) => i),
    rng
  );
  return { order, answerIndex: order.indexOf(q.answerIndex) };
}
