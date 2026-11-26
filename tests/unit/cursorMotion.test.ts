import { describe, expect, it } from 'vitest';
import { CursorMotion } from '../../src/gestures/cursorMotion';

/**
 * Display-only easing between detections. The important properties are: the first sample is
 * exact (no glide in from 0,0), motion is continuous at render rate, and a re-acquisition snaps
 * instead of dragging the ring across the screen.
 */
describe('CursorMotion', () => {
  it('starts exactly on the first detection', () => {
    const motion = new CursorMotion();
    expect(motion.sample('right', { x: 400, y: 300 }, 1000)).toEqual({ x: 400, y: 300 });
  });

  it('moves continuously towards a new target instead of jumping in one frame', () => {
    const motion = new CursorMotion();
    motion.sample('right', { x: 0, y: 0 }, 1000);

    // One detection 100 px away, then 8 ms render frames: no frame may cover the whole distance.
    let previous = motion.sample('right', { x: 100, y: 0 }, 1016);
    expect(previous.x).toBeGreaterThan(0);
    expect(previous.x).toBeLessThan(100);
    for (let i = 1; i <= 6; i += 1) {
      const next = motion.sample('right', { x: 100, y: 0 }, 1016 + i * 8);
      const step = next.x - previous.x;
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThan(100);
      previous = next;
    }
    expect(previous.x).toBeGreaterThan(50);
  });

  it('converges on a stationary target and stays there', () => {
    const motion = new CursorMotion();
    motion.sample('right', { x: 100, y: 100 }, 0);
    motion.sample('right', { x: 300, y: 100 }, 16);
    let point = { x: 0, y: 0 };
    for (let t = 32; t <= 1000; t += 16) point = motion.sample('right', { x: 300, y: 100 }, t);
    expect(point.x).toBeCloseTo(300, 3);
    expect(point.y).toBeCloseTo(100, 3);
  });

  it('snaps on a teleport (hand re-acquired on the other side of the screen)', () => {
    const motion = new CursorMotion();
    motion.sample('right', { x: 40, y: 40 }, 0);
    const point = motion.sample('right', { x: 1200, y: 700 }, 16);
    expect(point).toEqual({ x: 1200, y: 700 });
  });

  it('snaps after a long stale gap instead of gliding from an old position', () => {
    const motion = new CursorMotion();
    motion.sample('right', { x: 100, y: 100 }, 0);
    const point = motion.sample('right', { x: 140, y: 120 }, 1000);
    expect(point).toEqual({ x: 140, y: 120 });
  });

  it('keeps each hand independent and resets one side on demand', () => {
    const motion = new CursorMotion();
    motion.sample('left', { x: 10, y: 10 }, 0);
    motion.sample('right', { x: 500, y: 500 }, 0);
    motion.reset('left');
    expect(motion.peek('left')).toBeNull();
    expect(motion.peek('right')).toEqual({ x: 500, y: 500 });
  });
});
