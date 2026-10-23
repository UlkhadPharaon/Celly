import type { Vec3 } from '../types';

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (t: number): number => t * t * (3 - 2 * t);
export const mapRange = (v: number, a0: number, a1: number, b0: number, b1: number): number =>
  a1 === a0 ? b0 : b0 + ((v - a0) / (a1 - a0)) * (b1 - b0);

export function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function len3(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function normalize3(v: Vec3): Vec3 {
  const l = len3(v);
  return l < 1e-9 ? { x: 0, y: 0, z: 0 } : { x: v.x / l, y: v.y / l, z: v.z / l };
}

export function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

/** Deterministic mulberry32 PRNG. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

/** Uniform point on the unit sphere. */
export function unitVector(rng: () => number): [number, number, number] {
  const u = rng() * 2 - 1;
  const theta = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - u * u));
  return [r * Math.cos(theta), u, r * Math.sin(theta)];
}

/** Poisson-ish spread of directions on the sphere. */
export function spreadPoints(rng: () => number, count: number, minAngle: number, maxTries = 30): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  let guard = count * maxTries;
  while (out.length < count && guard-- > 0) {
    const v = unitVector(rng);
    let ok = true;
    for (const p of out) {
      const dot = p[0] * v[0] + p[1] * v[1] + p[2] * v[2];
      if (dot > Math.cos(minAngle)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(v);
  }
  while (out.length < count) out.push(unitVector(rng));
  return out;
}

/** Frame-rate independent exponential smoothing. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}
