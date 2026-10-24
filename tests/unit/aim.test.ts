import { describe, expect, it } from 'vitest';
import { AIM_CONFIG, CursorHistory, nearestWithin } from '../../src/gestures/aim';

describe('CursorHistory', () => {
  it('interpolates between timestamped samples and clamps at the edges', () => {
    const h = new CursorHistory();
    h.push(100, 0, 0);
    h.push(200, 100, 50);
    expect(h.sampleAt(50)).toMatchObject({ x: 0, y: 0 });
    expect(h.sampleAt(150)).toMatchObject({ x: 50, y: 25 });
    expect(h.sampleAt(300)).toMatchObject({ x: 100, y: 50 });
  });

  it('resets rather than interpolating when timestamps go backwards', () => {
    const h = new CursorHistory();
    h.push(200, 10, 10);
    h.push(100, 20, 20);
    expect(h.size).toBe(1);
    expect(h.sampleAt(150)).toMatchObject({ x: 20, y: 20 });
  });

  it('uses the pre-pinch sample for a slow, deliberate pinch', () => {
    const h = new CursorHistory();
    for (let t = 0; t <= 220; t += 20) h.push(t, t * 0.1, 10);
    const aim = h.aimFor(220);
    expect(aim.source).toBe('pre-pinch');
    expect(aim.point.x).toBeCloseTo((220 - AIM_CONFIG.prePinchMs) * 0.1, 4);
  });

  it('falls back to a recent sample when the hand travelled fast while closing', () => {
    const h = new CursorHistory();
    for (let t = 0; t <= 220; t += 10) h.push(t, t, 0);
    const aim = h.aimFor(220);
    expect(aim.source).toBe('recent');
    expect(aim.point.x).toBeCloseTo(220 - AIM_CONFIG.recentMs, 4);
  });

  it('keeps two samples even when their age exceeds the history window', () => {
    const h = new CursorHistory(50);
    h.push(0, 0, 0);
    h.push(1000, 10, 10);
    h.push(2000, 20, 20);
    expect(h.size).toBe(2);
  });
});

describe('nearestWithin', () => {
  const candidates = [
    { id: 'nucleus', x: 500, y: 400, radiusPx: 84 },
    { id: 'nucleolus', x: 510, y: 400, radiusPx: 18 },
    { id: 'mitochondrion', x: 700, y: 400, radiusPx: 20 }
  ];

  it('prefers the small structure when the cursor is on its centre', () => {
    expect(nearestWithin({ x: 510, y: 400 }, candidates, 48)?.id).toBe('nucleolus');
  });

  it('prefers the large structure at its centre', () => {
    expect(nearestWithin({ x: 500, y: 400 }, candidates, 48)?.id).toBe('nucleus');
  });

  it('uses hand-sized proximity and respects the base radius', () => {
    expect(nearestWithin({ x: 660, y: 400 }, candidates, 48)?.id).toBe('mitochondrion');
    expect(nearestWithin({ x: 640, y: 400 }, candidates, 48)).toBeNull();
  });

  it('caps a huge radius so one organelle cannot reach across the cell', () => {
    const huge = [{ id: 'nucleus', x: 500, y: 400, radiusPx: 500 }];
    expect(nearestWithin({ x: 500, y: 480 }, huge, 48)?.id).toBe('nucleus');
    expect(nearestWithin({ x: 500, y: 490 }, huge, 48)).toBeNull();
    expect(nearestWithin({ x: 0, y: 0 }, huge, 48)).toBeNull();
  });

  it('returns null when there is nothing near', () => {
    expect(nearestWithin({ x: 0, y: 0 }, candidates, 48)).toBeNull();
    expect(nearestWithin({ x: 0, y: 0 }, [], 48)).toBeNull();
  });
});
