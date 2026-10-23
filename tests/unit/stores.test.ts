import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LeitnerStore } from '../../src/pages/testing/leitner';
import { ProgressStore, gradeRatio, scoreLabel } from '../../src/pages/testing/progress';

class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe('LeitnerStore', () => {
  const ids = ['a', 'b', 'c'];

  it('starts every card in box 1 and marks it fresh', () => {
    const store = new LeitnerStore();
    expect(store.get('a')).toEqual({ box: 1, lastSeen: 0, correct: 0, wrong: 0 });
    expect(store.stats(ids)).toEqual({ total: 3, fresh: 3, learning: 0, mastered: 0 });
  });

  it('promotes on a correct answer and caps at box 5', () => {
    const store = new LeitnerStore();
    let state = store.answer('a', true, 1000);
    expect(state.box).toBe(2);
    expect(state.correct).toBe(1);
    for (let i = 0; i < 10; i++) state = store.answer('a', true, 2000 + i);
    expect(state.box).toBe(5);
    expect(state.correct).toBe(11);
    expect(store.stats(['a']).mastered).toBe(1);
  });

  it('demotes to box 1 on a wrong answer', () => {
    const store = new LeitnerStore();
    for (let i = 0; i < 4; i++) store.answer('a', true, 1000 + i);
    const state = store.answer('a', false, 2000);
    expect(state.box).toBe(1);
    expect(state.wrong).toBe(1);
    expect(store.stats(['a']).learning).toBe(1);
  });

  it('orders due cards by box, then least recently seen', () => {
    const store = new LeitnerStore();
    store.answer('c', true, 100);
    store.answer('c', true, 200);
    store.answer('b', true, 300);
    store.answer('a', false, 400);
    expect(store.order(ids)).toEqual(['a', 'b', 'c']);
  });

  it('persists answers and drops corrupt records on load', () => {
    const store = new LeitnerStore();
    store.answer('a', true, 1000);
    const reloaded = new LeitnerStore();
    expect(reloaded.get('a')).toMatchObject({ box: 2, correct: 1, lastSeen: 1000 });

    localStorage.setItem(
      'celly:v02:leitner',
      JSON.stringify({ a: { box: 99, lastSeen: 'x', correct: -3, wrong: 'nope' }, z: null })
    );
    const sanitised = new LeitnerStore();
    expect(sanitised.get('a')).toEqual({ box: 5, lastSeen: 0, correct: 0, wrong: 0 });
    expect(sanitised.get('z')).toEqual({ box: 1, lastSeen: 0, correct: 0, wrong: 0 });
  });

  it('resets every card', () => {
    const store = new LeitnerStore();
    store.answer('a', true, 1000);
    store.reset();
    expect(store.get('a').box).toBe(1);
    expect(store.get('a').lastSeen).toBe(0);
  });
});

describe('ProgressStore', () => {
  it('grades a ratio into a letter and a label', () => {
    expect(gradeRatio(1)).toBe('A');
    expect(gradeRatio(0.9)).toBe('A');
    expect(gradeRatio(0.8)).toBe('B');
    expect(gradeRatio(0.6)).toBe('C');
    expect(gradeRatio(0.2)).toBe('D');
    expect(scoreLabel(0.96)).toBe('Flawless');
    expect(scoreLabel(0.86)).toBe('Excellent');
    expect(scoreLabel(0.5)).toBe('Getting there');
    expect(scoreLabel(0)).toBe('Keep going');
  });

  it('keeps the best ratio per quiz and counts attempts', () => {
    const store = new ProgressStore();
    store.record('set-basics', 0.6);
    store.record('set-basics', 0.4);
    store.record('set-basics', 0.9);
    expect(store.best('set-basics')).toBeCloseTo(0.9);
    expect(store.best('unknown')).toBe(0);
    expect(store.attempts).toBe(3);
  });

  it('persists and resets', () => {
    const store = new ProgressStore();
    store.record('set-basics', 0.8);
    const reloaded = new ProgressStore();
    expect(reloaded.best('set-basics')).toBeCloseTo(0.8);
    reloaded.reset();
    expect(reloaded.best('set-basics')).toBe(0);
    expect(reloaded.attempts).toBe(0);
  });
});
