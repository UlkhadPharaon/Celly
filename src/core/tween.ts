/** Cancellable tweens driven by the render clock. Replaces GSAP (see DECISIONS D-03). */

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number): number => t,
  inCubic: (t: number): number => t * t * t,
  outCubic: (t: number): number => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuint: (t: number): number => 1 - Math.pow(1 - t, 5),
  outExpo: (t: number): number => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outBack: (t: number): number => {
    const c = 1.70158;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  },
  outElastic: (t: number): number => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  }
};

export interface TweenHandle {
  cancel(): void;
  readonly done: boolean;
}

export class Tweens {
  private items: Array<{ elapsed: number; duration: number; ease: Ease; update: (t: number) => void; done: () => void }> =
    [];
  private dirty = false;

  /** Schedule a tween. `update` receives the eased 0..1 progress. */
  add(durationMs: number, update: (t: number) => void, easing: Ease = ease.outCubic, onComplete?: () => void): TweenHandle {
    const item = {
      elapsed: 0,
      duration: Math.max(1, durationMs),
      ease: easing,
      update,
      done: () => {
        item.elapsed = -1;
        this.dirty = true;
        onComplete?.();
      }
    };
    this.items.push(item);
    const handle: TweenHandle = {
      cancel: () => {
        item.elapsed = -1;
        this.dirty = true;
      },
      get done() {
        return item.elapsed < 0;
      }
    };
    return handle;
  }

  /** Number tween helper. */
  number(from: number, to: number, durationMs: number, onUpdate: (v: number) => void, easing?: Ease): TweenHandle {
    return this.add(durationMs, (t) => onUpdate(from + (to - from) * t), easing);
  }

  update(dtMs: number): void {
    for (const item of this.items) {
      if (item.elapsed < 0) continue;
      item.elapsed += dtMs;
      const raw = Math.min(1, item.elapsed / item.duration);
      item.update(item.ease(raw));
      if (raw >= 1) item.done();
    }
    if (this.dirty) {
      this.items = this.items.filter((i) => i.elapsed >= 0);
      this.dirty = false;
    }
  }

  clear(): void {
    this.items = [];
  }
}
