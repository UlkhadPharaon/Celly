import type { Vec3 } from '../types';
import { makeRng } from '../core/math';

export interface LayoutEdge {
  a: string;
  b: string;
}

/**
 * Deterministic 3D force layout (Fruchterman–Reingold variant).
 * Runs once at boot, so the network is identical on every reload / screenshot.
 * See DECISIONS D-04.
 */
export function layout3d(
  ids: string[],
  edges: LayoutEdge[],
  opts: { seed?: number; iterations?: number; spread?: number } = {}
): Map<string, Vec3> {
  const seed = opts.seed ?? 7;
  const iterations = opts.iterations ?? 420;
  const spread = opts.spread ?? 4.4;
  const rng = makeRng(seed);
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));

  // Fibonacci sphere + jitter gives an even, isotropic starting cloud.
  const pos: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(1, n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * 2.399963229728653;
    pos.push({
      x: Math.cos(theta) * r * 3.2 + (rng() - 0.5) * 0.6,
      y: y * 3.2 + (rng() - 0.5) * 0.6,
      z: Math.sin(theta) * r * 3.2 + (rng() - 0.5) * 0.6
    });
  }

  const pairIndex = edges
    .map((e) => {
      const a = index.get(e.a);
      const b = index.get(e.b);
      return a === undefined || b === undefined || a === b ? null : ([a, b] as [number, number]);
    })
    .filter((x): x is [number, number] => !!x);

  const k = 1.75;
  const disp: Vec3[] = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));

  for (let iter = 0; iter < iterations; iter++) {
    const temp = (1 - iter / iterations) * 0.55 + 0.02;
    for (const d of disp) {
      d.x = 0;
      d.y = 0;
      d.z = 0;
    }

    // Repulsion
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        let dz = pos[i].z - pos[j].z;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.04) {
          dx = (rng() - 0.5) * 0.2;
          dy = (rng() - 0.5) * 0.2;
          dz = (rng() - 0.5) * 0.2;
          d2 = dx * dx + dy * dy + dz * dz + 0.02;
        }
        const d = Math.sqrt(d2);
        const f = (k * k) / d;
        const ux = dx / d;
        const uy = dy / d;
        const uz = dz / d;
        disp[i].x += ux * f;
        disp[i].y += uy * f;
        disp[i].z += uz * f;
        disp[j].x -= ux * f;
        disp[j].y -= uy * f;
        disp[j].z -= uz * f;
      }
    }

    // Springs
    for (const [a, b] of pairIndex) {
      const dx = pos[a].x - pos[b].x;
      const dy = pos[a].y - pos[b].y;
      const dz = pos[a].z - pos[b].z;
      const d = Math.max(0.08, Math.sqrt(dx * dx + dy * dy + dz * dz));
      const f = ((d * d) / k) * 0.14;
      const ux = dx / d;
      const uy = dy / d;
      const uz = dz / d;
      disp[a].x -= ux * f;
      disp[a].y -= uy * f;
      disp[a].z -= uz * f;
      disp[b].x += ux * f;
      disp[b].y += uy * f;
      disp[b].z += uz * f;
    }

    // Gravity toward the centroid keeps disconnected clusters from drifting away.
    for (let i = 0; i < n; i++) {
      disp[i].x -= pos[i].x * 0.05;
      disp[i].y -= pos[i].y * 0.05;
      disp[i].z -= pos[i].z * 0.05;
    }

    for (let i = 0; i < n; i++) {
      const d = disp[i];
      const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
      if (len < 1e-6) continue;
      const step = Math.min(len, temp) / len;
      pos[i].x += d.x * step;
      pos[i].y += d.y * step;
      pos[i].z += d.z * step;
    }
  }

  // Normalise into a comfortable viewing radius.
  let maxR = 0.001;
  for (const p of pos) maxR = Math.max(maxR, Math.hypot(p.x, p.y, p.z));
  const scale = spread / maxR;
  const out = new Map<string, Vec3>();
  ids.forEach((id, i) => {
    out.set(id, { x: pos[i].x * scale, y: pos[i].y * scale, z: pos[i].z * scale });
  });
  return out;
}
