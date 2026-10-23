import type { FlashcardState, LeitnerBox } from '../../types';
import { loadJSON, saveJSON } from '../../core/store';

const KEY = 'celly:v02:leitner';

export function emptyCard(): FlashcardState {
  return { box: 1, lastSeen: 0, correct: 0, wrong: 0 };
}

/**
 * Leitner boxes 1–5 (DECISIONS D-27):
 * correct → box + 1 (capped at 5); wrong → box 1. Due cards are ordered by box,
 * then by least-recently seen.
 */
export class LeitnerStore {
  private cards: Record<string, FlashcardState>;

  constructor() {
    const raw = loadJSON<Record<string, FlashcardState>>(KEY, {});
    this.cards = {};
    for (const [id, state] of Object.entries(raw)) {
      if (!state || typeof state !== 'object') continue;
      const box = Math.min(5, Math.max(1, Math.round(Number(state.box) || 1))) as LeitnerBox;
      this.cards[id] = {
        box,
        lastSeen: Number(state.lastSeen) || 0,
        correct: Math.max(0, Number(state.correct) || 0),
        wrong: Math.max(0, Number(state.wrong) || 0)
      };
    }
  }

  get(id: string): FlashcardState {
    return this.cards[id] ?? emptyCard();
  }

  answer(id: string, correct: boolean, now = Date.now()): FlashcardState {
    const previous = this.get(id);
    const box = (correct ? Math.min(5, previous.box + 1) : 1) as LeitnerBox;
    const next: FlashcardState = {
      box,
      lastSeen: now,
      correct: previous.correct + (correct ? 1 : 0),
      wrong: previous.wrong + (correct ? 0 : 1)
    };
    this.cards[id] = next;
    this.save();
    return next;
  }

  /** Box 1 first, oldest-seen first. `ids` defines the universe of cards. */
  order(ids: readonly string[]): string[] {
    return [...ids].sort((a, b) => {
      const ca = this.get(a);
      const cb = this.get(b);
      if (ca.box !== cb.box) return ca.box - cb.box;
      return ca.lastSeen - cb.lastSeen;
    });
  }

  stats(ids: readonly string[]): { total: number; fresh: number; learning: number; mastered: number } {
    let fresh = 0;
    let learning = 0;
    let mastered = 0;
    for (const id of ids) {
      const card = this.get(id);
      if (card.lastSeen === 0) fresh++;
      else if (card.box >= 5) mastered++;
      else learning++;
    }
    return { total: ids.length, fresh, learning, mastered };
  }

  reset(): void {
    this.cards = {};
    this.save();
  }

  private save(): void {
    saveJSON(KEY, this.cards);
  }
}
