import { describe, expect, it } from 'vitest';
import { Tweens, ease } from '../../src/core/tween';

/**
 * Reduce motion (audit task 3.1). The scene manager, the interactive lab and the knowledge graph
 * all schedule camera/element moves through this class, so one contract here is what makes every
 * transition snap when the preference is on.
 */
describe('Tweens — reduce motion', () => {
  it('applies the final frame synchronously and completes', () => {
    const tweens = new Tweens();
    tweens.reducedMotion = true;

    const values: number[] = [];
    let completed = false;
    const handle = tweens.add(
      800,
      (t) => values.push(t),
      ease.outCubic,
      () => {
        completed = true;
      }
    );

    expect(values).toEqual([1]);
    expect(completed).toBe(true);
    expect(handle.done).toBe(true);
    // Nothing remains to animate on subsequent ticks.
    tweens.update(16);
    expect(values).toEqual([1]);
  });

  it('snaps in-flight tweens to their destination when the preference flips', () => {
    const tweens = new Tweens();
    let value = 0;
    let completed = false;
    tweens.add(
      1000,
      (t) => {
        value = t;
      },
      ease.linear,
      () => {
        completed = true;
      }
    );

    tweens.update(400);
    expect(value).toBeCloseTo(0.4);

    tweens.reducedMotion = true;
    tweens.finishAll();
    expect(value).toBe(1);
    expect(completed).toBe(true);
  });

  it('leaves normal tweening untouched when the preference is off', () => {
    const tweens = new Tweens();
    let value = 0;
    tweens.add(1000, (t) => {
      value = t;
    }, ease.linear);

    tweens.update(250);
    expect(value).toBeCloseTo(0.25);
    expect(tweens.reducedMotion).toBe(false);
  });
});
