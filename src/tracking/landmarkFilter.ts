import type { Vec3 } from '../types';

/**
 * One-Euro filter (Casiez et al., CHI 2012) for a single scalar channel.
 * Low latency at speed, strong jitter removal at rest.
 */
export class OneEuroFilter {
  private prevRaw: number | null = null;
  private prevFiltered = 0;
  private prevDeriv = 0;

  constructor(
    public minCutoff = 1.0,
    public beta = 0.05,
    public dCutoff = 1.0
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  reset(value?: number): void {
    this.prevRaw = value ?? null;
    this.prevFiltered = value ?? 0;
    this.prevDeriv = 0;
  }

  filter(value: number, dt: number): number {
    if (!Number.isFinite(value)) return this.prevFiltered;
    const d = Math.max(1e-4, Math.min(0.2, dt));
    if (this.prevRaw === null) {
      this.prevRaw = value;
      this.prevFiltered = value;
      return value;
    }
    const dx = (value - this.prevRaw) / d;
    const ad = OneEuroFilter.alpha(this.dCutoff, d);
    this.prevDeriv = ad * dx + (1 - ad) * this.prevDeriv;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.prevDeriv);
    const a = OneEuroFilter.alpha(cutoff, d);
    this.prevFiltered = a * value + (1 - a) * this.prevFiltered;
    this.prevRaw = value;
    return this.prevFiltered;
  }
}

/**
 * One filter per landmark coordinate, kept per tracking slot.
 * Two banks (normalized + world) keep screen and metric signals independent.
 */
export class LandmarkFilterBank {
  private banks = new Map<string, OneEuroFilter[]>();
  private readonly size: number;

  constructor(
    private readonly minCutoff = 1.2,
    private readonly beta = 0.08,
    private readonly dCutoff = 1.0
  ) {
    this.size = 21 * 3;
  }

  private bank(key: string): OneEuroFilter[] {
    let b = this.banks.get(key);
    if (!b) {
      b = Array.from({ length: this.size }, () => new OneEuroFilter(this.minCutoff, this.beta, this.dCutoff));
      this.banks.set(key, b);
    }
    return b;
  }

  filter(key: string, points: Vec3[], dt: number): Vec3[] {
    const b = this.bank(key);
    const out: Vec3[] = new Array(points.length);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const o = i * 3;
      out[i] = {
        x: b[o].filter(p.x, dt),
        y: b[o + 1].filter(p.y, dt),
        z: b[o + 2].filter(p.z, dt)
      };
    }
    return out;
  }

  reset(key: string): void {
    this.banks.delete(key);
  }

  resetAll(): void {
    this.banks.clear();
  }

  setParams(minCutoff: number, beta: number): void {
    this.banks.clear();
    // Filters are recreated on next use with the new params.
    Object.defineProperties(this, {
      minCutoff: { value: minCutoff, writable: true },
      beta: { value: beta, writable: true }
    });
  }
}

/** Mean absolute frame-to-frame movement of a landmark set, normalized units. */
export function motionEnergy(prev: Vec3[] | null, next: Vec3[]): number {
  if (!prev || prev.length !== next.length) return 0;
  let sum = 0;
  for (let i = 0; i < next.length; i++) {
    sum += Math.abs(next[i].x - prev[i].x) + Math.abs(next[i].y - prev[i].y);
  }
  return sum / next.length;
}
