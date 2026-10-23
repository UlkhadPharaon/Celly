import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng, range } from '../core/math';

/**
 * Organic blob: an icosphere displaced by summed sines. Deterministic per seed so
 * screenshots and reloads look identical.
 */
export function blobGeometry(radius: number, detail = 3, amplitude = 0.09, seed = 1): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const s = seed * 1.7;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const wobble =
      Math.sin(n.x * 4.1 + s) * Math.cos(n.y * 3.7 - s * 0.6) * Math.sin(n.z * 4.9 + s * 0.3) * 0.6 +
      Math.sin(n.x * 8.3 - s) * Math.cos(n.z * 7.1 + s) * 0.4;
    v.copy(n).multiplyScalar(radius * (1 + wobble * amplitude));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export function ellipsoidGeometry(rx: number, ry: number, rz: number, detail = 3): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  geo.scale(rx, ry, rz);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Flat undulating sheet in the XZ plane. Used for ER cisternae and Golgi plates.
 * `bend` curves the sheet around the Y axis so it can wrap the nucleus.
 */
export function ribbonGeometry(
  length: number,
  width: number,
  opts: { segsX?: number; segsY?: number; waveAmp?: number; waveFreq?: number; bend?: number; seed?: number } = {}
): THREE.BufferGeometry {
  const segsX = opts.segsX ?? 44;
  const segsY = opts.segsY ?? 10;
  const waveAmp = opts.waveAmp ?? 0.09;
  const waveFreq = opts.waveFreq ?? 2.4;
  const bend = opts.bend ?? 0;
  const seed = opts.seed ?? 1;

  const positions: number[] = [];
  const indices: number[] = [];
  for (let ix = 0; ix <= segsX; ix++) {
    const u = ix / segsX;
    const x = (u - 0.5) * length;
    for (let iy = 0; iy <= segsY; iy++) {
      const v = iy / segsY;
      const z = (v - 0.5) * width;
      const y =
        Math.sin(u * Math.PI * waveFreq + seed) * waveAmp +
        Math.sin(v * Math.PI * 2 + seed * 0.7) * waveAmp * 0.35 +
        bend * (u - 0.5) * (u - 0.5) * 4;
      positions.push(x, y, z);
    }
  }
  for (let ix = 0; ix < segsX; ix++) {
    for (let iy = 0; iy < segsY; iy++) {
      const a = ix * (segsY + 1) + iy;
      const b = a + segsY + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function tubeGeometry(points: THREE.Vector3[], radius: number, radialSegments = 6, tubularSegments = 48): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  return new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
}

/** Nine microtubule triplets in a barrel, merged into a single draw call. */
export function centrioleGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const g = new THREE.CylinderGeometry(0.006, 0.006, 0.085, 5, 1, true);
    g.translate(Math.cos(a) * 0.028, 0, Math.sin(a) * 0.028);
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) throw new Error('centriole merge failed');
  merged.rotateX(Math.PI / 2);
  return merged;
}

/** A curved Golgi cisterna: a flattened partial torus. */
export function golgiCisternaGeometry(radius: number, arc: number, thickness: number): THREE.BufferGeometry {
  const geo = new THREE.TorusGeometry(radius, thickness, 8, 64, arc);
  geo.scale(1, 1, 0.42);
  geo.rotateX(Math.PI / 2);
  return geo;
}

/** Lysosome / peroxisome granules merged into the parent mesh. */
export function granuleCluster(count: number, radius: number, seed: number): THREE.BufferGeometry {
  const rng = makeRng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const r = radius * (0.16 + rng() * 0.16);
    const g = new THREE.IcosahedronGeometry(r, 1);
    const dir = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    g.translate(dir.x * radius * 0.72, dir.y * radius * 0.72, dir.z * radius * 0.72);
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) throw new Error('granule merge failed');
  return merged;
}

/** Radiating microtubule web, merged into one geometry. */
export function microtubuleGeometry(count: number, inner: number, outer: number, seed: number): THREE.BufferGeometry {
  const rng = makeRng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const from = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize().multiplyScalar(inner);
    const dir = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    const to = from.clone().addScaledVector(dir, range(rng, outer * 0.4, outer));
    const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.35));
    parts.push(tubeGeometry([from, mid, to], 0.0035, 4, 14));
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) throw new Error('microtubule merge failed');
  return merged;
}

/** Points sampled on a sphere surface, used for nuclear pores. */
export function sphereSurfacePoints(count: number, radius: number, seed: number): Float32Array {
  const rng = makeRng(seed);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = rng() * 2 - 1;
    const theta = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    out[i * 3] = r * Math.cos(theta) * radius;
    out[i * 3 + 1] = u * radius;
    out[i * 3 + 2] = r * Math.sin(theta) * radius;
  }
  return out;
}
