import { describe, expect, it } from 'vitest';
import {
  FLASHCARDS,
  KNOWLEDGE_BY_ID,
  KNOWLEDGE_NODES,
  MCQ_BY_ID,
  MCQS,
  ORGANELLES,
  ORGANELLE_BY_ID,
  QUESTIONNAIRES
} from '../../src/data/catalog';
import { prepareQuestion, shuffled } from '../../src/data/catalog';
import type { Loc } from '../../src/types';

const hasText = (value: Loc | undefined): boolean => !!value && value.en.trim().length > 0;
const hasFrench = (value: Loc | undefined): boolean => !!value && !!value.fr && value.fr.trim().length > 0;
const HEX = /^#[0-9a-f]{6}$/i;

describe('content inventory meets the v0.2 minimums', () => {
  it('ships 15 organelles', () => {
    expect(ORGANELLES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(ORGANELLES.map((o) => o.id)).size).toBe(ORGANELLES.length);
  });

  it('ships at least 30 knowledge nodes', () => {
    expect(KNOWLEDGE_NODES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(KNOWLEDGE_NODES.map((n) => n.id)).size).toBe(KNOWLEDGE_NODES.length);
  });

  it('ships at least 40 multiple-choice questions', () => {
    expect(MCQS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(MCQS.map((q) => q.id)).size).toBe(MCQS.length);
  });

  it('ships at least 30 flashcards', () => {
    expect(FLASHCARDS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(FLASHCARDS.map((f) => f.id)).size).toBe(FLASHCARDS.length);
  });

  it('ships at least 3 questionnaire sets', () => {
    expect(QUESTIONNAIRES.length).toBeGreaterThanOrEqual(3);
    expect(new Set(QUESTIONNAIRES.map((s) => s.id)).size).toBe(QUESTIONNAIRES.length);
  });
});

describe('organelle metadata', () => {
  it('is complete and bilingual', () => {
    for (const organelle of ORGANELLES) {
      expect(hasText(organelle.name), organelle.id).toBe(true);
      expect(hasFrench(organelle.name), organelle.id).toBe(true);
      expect(hasText(organelle.shortDescription), organelle.id).toBe(true);
      expect(hasFrench(organelle.shortDescription), organelle.id).toBe(true);
      expect(hasText(organelle.structure), organelle.id).toBe(true);
      expect(hasFrench(organelle.structure), organelle.id).toBe(true);
      expect(hasText(organelle.funFact), organelle.id).toBe(true);
      expect(hasFrench(organelle.funFact), organelle.id).toBe(true);
      expect(organelle.function.en.length, organelle.id).toBeGreaterThanOrEqual(2);
      expect(organelle.function.fr?.length, organelle.id).toBe(organelle.function.en.length);
      expect(organelle.color).toMatch(HEX);
    }
  });

  it('only links to known organelles', () => {
    for (const organelle of ORGANELLES) {
      for (const id of organelle.relatedIds) {
        expect(ORGANELLE_BY_ID.has(id), `${organelle.id} -> ${id}`).toBe(true);
      }
    }
  });
});

describe('knowledge graph', () => {
  it('has complete bilingual nodes with valid links', () => {
    for (const node of KNOWLEDGE_NODES) {
      expect(hasText(node.label), node.id).toBe(true);
      expect(hasFrench(node.label), node.id).toBe(true);
      expect(hasText(node.summary), node.id).toBe(true);
      expect(hasFrench(node.summary), node.id).toBe(true);
      expect(node.details.en.length, node.id).toBeGreaterThanOrEqual(3);
      expect(node.details.fr?.length, node.id).toBe(node.details.en.length);
      expect(node.color).toMatch(HEX);
      expect(node.size).toBeGreaterThanOrEqual(1);
      expect(node.size).toBeLessThanOrEqual(5);
      for (const link of node.links) {
        expect(KNOWLEDGE_BY_ID.has(link), `${node.id} -> ${link}`).toBe(true);
        expect(link).not.toBe(node.id);
      }
      if (node.organelleId) {
        expect(ORGANELLE_BY_ID.has(node.organelleId), `${node.id} -> ${node.organelleId}`).toBe(true);
      }
      for (const quizId of node.quizIds ?? []) {
        expect(MCQ_BY_ID.has(quizId), `${node.id} -> ${quizId}`).toBe(true);
      }
    }
  });
});

describe('assessment content', () => {
  it('has four options, a valid answer and an explanation for every question', () => {
    for (const q of MCQS) {
      expect(q.options.length, q.id).toBe(4);
      expect(q.answerIndex, q.id).toBeGreaterThanOrEqual(0);
      expect(q.answerIndex, q.id).toBeLessThan(4);
      expect(hasText(q.question), q.id).toBe(true);
      expect(hasFrench(q.question), q.id).toBe(true);
      expect(hasText(q.explanation), q.id).toBe(true);
      expect(hasFrench(q.explanation), q.id).toBe(true);
      expect(['easy', 'medium', 'hard']).toContain(q.difficulty);
      expect(new Set(q.options.map((o) => o.en)).size, q.id).toBe(4);
      for (const option of q.options) {
        expect(hasText(option), q.id).toBe(true);
        expect(hasFrench(option), q.id).toBe(true);
      }
      for (const linked of q.linkedIds) {
        const known = KNOWLEDGE_BY_ID.has(linked) || ORGANELLE_BY_ID.has(linked);
        expect(known, `${q.id} -> ${linked}`).toBe(true);
      }
    }
  });

  it('has bilingual flashcards', () => {
    for (const card of FLASHCARDS) {
      expect(hasText(card.front), card.id).toBe(true);
      expect(hasFrench(card.front), card.id).toBe(true);
      expect(hasText(card.back), card.id).toBe(true);
      expect(hasFrench(card.back), card.id).toBe(true);
    }
  });

  it('builds questionnaires from real questions', () => {
    for (const set of QUESTIONNAIRES) {
      expect(set.questionIds.length, set.id).toBeGreaterThanOrEqual(5);
      expect(hasText(set.title), set.id).toBe(true);
      expect(hasFrench(set.title), set.id).toBe(true);
      for (const id of set.questionIds) {
        expect(MCQ_BY_ID.has(id), `${set.id} -> ${id}`).toBe(true);
      }
      expect(new Set(set.questionIds).size, set.id).toBe(set.questionIds.length);
    }
  });
});

describe('session helpers', () => {
  it('shuffles deterministically for a given rng and keeps every item', () => {
    const rng = () => 0.42;
    const a = shuffled([1, 2, 3, 4, 5], rng);
    const b = shuffled([1, 2, 3, 4, 5], rng);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('tracks the answer through a shuffled option order', () => {
    for (const q of MCQS) {
      const { order, answerIndex } = prepareQuestion(q, () => 0.5);
      expect(order).toHaveLength(4);
      expect(order[answerIndex]).toBe(q.answerIndex);
    }
  });
});
