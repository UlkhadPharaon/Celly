import type { HandSide, Vec2 } from '../types';

export interface CursorSample {
  t: number;
  x: number;
  y: number;
}

export const AIM_CONFIG = {
  /** Keep enough history to survive a dropped inference frame. */
  historyMs: 420,
  /** The true aim point is this far before the pinch threshold was crossed. */
  prePinchMs: 100,
  /** If the hand travelled more than this while closing, prefer a recent sample. */
  fastMovePx: 55,
  /** How recent the fallback sample is for a fast reposition-then-pinch. */
  recentMs: 35
} as const;

/**
 * Timestamped cursor ring buffer. Selection uses the cursor from before the fingertips converge,
 * not the midpoint at the instant `pinchStart` fires.
 */
export class CursorHistory {
  private samples: CursorSample[] = [];

  constructor(private readonly maxAgeMs: number = AIM_CONFIG.historyMs) {}

  push(t: number, x: number, y: number): void {
    if (!Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const last = this.samples[this.samples.length - 1];
    if (last && t < last.t) {
      // Time went backwards (tab resume / synthetic injection): start a fresh history rather
      // than producing a sample from the future.
      this.samples = [];
    }
    this.samples.push({ t, x, y });
    const cutoff = t - this.maxAgeMs;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();
  }

  get size(): number {
    return this.samples.length;
  }

  /** Linear interpolation. Clamps to the oldest/newest sample, never returns NaN. */
  sampleAt(t: number): CursorSample | null {
    const n = this.samples.length;
    if (!n) return null;
    if (t <= this.samples[0].t) return { ...this.samples[0] };
    if (t >= this.samples[n - 1].t) return { ...this.samples[n - 1] };
    let lo = 0;
    let hi = n - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (this.samples[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = this.samples[lo];
    const b = this.samples[hi];
    const span = b.t - a.t;
    if (span <= 1e-6) return { ...a, t };
    const k = (t - a.t) / span;
    return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }

  /**
   * Pick the aim point for a pinch candidate. Slow, deliberate aim gets the full pre-pinch
   * look-back. If the hand was still travelling into position, the older sample would point at
   * the previous organelle, so we fall back to a recent sample instead.
   */
  aimFor(candidateAt: number): { point: Vec2; source: 'pre-pinch' | 'recent' | 'settled' } {
    const settled = this.sampleAt(candidateAt);
    const before = this.sampleAt(candidateAt - AIM_CONFIG.prePinchMs);
    if (!settled) return { point: before ?? { x: 0, y: 0 }, source: 'settled' };
    if (!before) return { point: { x: settled.x, y: settled.y }, source: 'settled' };

    const travel = Math.hypot(settled.x - before.x, settled.y - before.y);
    if (travel > AIM_CONFIG.fastMovePx) {
      const recent = this.sampleAt(candidateAt - AIM_CONFIG.recentMs) ?? settled;
      return { point: { x: recent.x, y: recent.y }, source: 'recent' };
    }
    return { point: { x: before.x, y: before.y }, source: 'pre-pinch' };
  }

  reset(): void {
    this.samples = [];
  }
}

/** Per-hand history used by the app's selection path. */
export class AimTracker {
  private readonly histories = new Map<HandSide, CursorHistory>();

  push(side: HandSide, t: number, cursor: Vec2): void {
    this.history(side).push(t, cursor.x, cursor.y);
  }

  aimFor(side: HandSide, candidateAt: number): { point: Vec2; source: string } {
    return this.history(side).aimFor(candidateAt);
  }

  reset(side?: HandSide): void {
    if (side) this.histories.get(side)?.reset();
    else this.histories.clear();
  }

  private history(side: HandSide): CursorHistory {
    let h = this.histories.get(side);
    if (!h) {
      h = new CursorHistory();
      this.histories.set(side, h);
    }
    return h;
  }
}

/** Pure nearest-target helper used by screen-space proximity picking. */
export function nearestWithin(
  point: Vec2,
  candidates: Array<{ id: string; x: number; y: number; radiusPx: number }>,
  baseRadiusPx: number
): { id: string; distancePx: number } | null {
  let best: { id: string; distancePx: number } | null = null;
  for (const c of candidates) {
    const d = Math.hypot(c.x - point.x, c.y - point.y);
    // Never let one large organelle's centre reach across the whole cell. The proximity radius is
    // hand-sized (40–60 px) and only grows modestly for genuinely large structures.
    const allowed = Math.max(baseRadiusPx, Math.min(c.radiusPx, 84));
    if (d > allowed) continue;
    if (!best || d < best.distancePx) best = { id: c.id, distancePx: d };
  }
  return best;
}
