import { describe, expect, it } from 'vitest';
import { LandmarkFilterBank, OneEuroFilter, sanitizeDt } from '../../src/tracking/landmarkFilter';

/**
 * One-Euro filtering with worker-paced, variable sample spacing (audit task 5.2). Detections arrive
 * when inference finishes, so `dt` is never uniform: it can stall for half a second or come back
 * to back. The filter must keep smoothing in both cases and must never overshoot the raw signal.
 */

describe('sanitizeDt', () => {
  it('clamps to the tuned range and survives garbage', () => {
    expect(sanitizeDt(1 / 60)).toBeCloseTo(1 / 60);
    expect(sanitizeDt(0)).toBeCloseTo(1 / 120);
    expect(sanitizeDt(0.0001)).toBeCloseTo(1 / 120);
    expect(sanitizeDt(0.5)).toBeCloseTo(0.2);
    // Non-finite spacing carries no information, so the nominal cadence is used.
    expect(sanitizeDt(Number.NaN)).toBeCloseTo(1 / 30);
    expect(sanitizeDt(Number.POSITIVE_INFINITY)).toBeCloseTo(1 / 30);
    expect(sanitizeDt(-1)).toBeCloseTo(1 / 120);
  });
});

describe('OneEuroFilter — variable spacing', () => {
  it('never overshoots the raw signal across a long stall', () => {
    const filter = new OneEuroFilter();
    filter.filter(0, 1 / 60);
    // Stall, then a real jump: the output may lag, but must not pass the new value.
    const jumped = filter.filter(1, 0.5);
    expect(jumped).toBeGreaterThan(0);
    expect(jumped).toBeLessThan(1);

    // And it keeps converging monotonically afterwards.
    let previous = jumped;
    for (let i = 0; i < 4; i += 1) {
      const out = filter.filter(1, 1 / 60);
      expect(out).toBeGreaterThanOrEqual(previous);
      expect(out).toBeLessThanOrEqual(1);
      previous = out;
    }
    expect(previous).toBeGreaterThan(jumped);
  });

  it('keeps smoothing after a NaN or negative interval', () => {
    const filter = new OneEuroFilter(1.2, 0.08, 1);
    filter.filter(0.5, 1 / 60);
    filter.filter(0.5, Number.NaN);
    filter.filter(0.5, -0.016);
    const jittered = filter.filter(0.5 + 0.05, 1 / 60);
    const raw = 0.5 + 0.05;
    // Still attenuated rather than passed through, i.e. the state was not destroyed.
    expect(jittered).toBeLessThan(raw);
    expect(Number.isFinite(jittered)).toBe(true);
  });

  it('attenuates steady jitter whatever the spacing', () => {
    for (const spacing of [1 / 120, 1 / 60, 1 / 30, 0.15]) {
      const filter = new OneEuroFilter(1.2, 0.08, 1);
      filter.filter(0.5, spacing);
      let rawVariance = 0;
      let filteredVariance = 0;
      let prevRaw = 0.5;
      let prevFiltered = 0.5;
      for (let i = 0; i < 60; i += 1) {
        const raw = 0.5 + (i % 2 === 0 ? 0.04 : -0.04);
        const out = filter.filter(raw, spacing);
        rawVariance += Math.abs(raw - prevRaw);
        filteredVariance += Math.abs(out - prevFiltered);
        prevRaw = raw;
        prevFiltered = out;
      }
      expect(rawVariance).toBeGreaterThan(0);
      expect(filteredVariance).toBeLessThan(rawVariance);
    }
  });
});

describe('LandmarkFilterBank', () => {
  it('filters every channel and reuses state per key', () => {
    const bank = new LandmarkFilterBank(1.2, 0.08, 1);
    const point = { x: 0.5, y: 0.5, z: 0 };
    const first = bank.filter('n:left', Array.from({ length: 21 }, () => point), 1 / 60);
    expect(first).toHaveLength(21);
    const jittered = Array.from({ length: 21 }, () => ({ x: 0.5 + 0.04, y: 0.5, z: 0 }));
    const second = bank.filter('n:left', jittered, 1 / 60);
    expect(second[0].x).toBeLessThan(0.54);
    // A different key starts fresh, so it is not dragged by the first hand's state.
    expect(bank.filter('n:right', jittered, 1 / 60)[0].x).toBeCloseTo(0.54, 3);
  });
});
