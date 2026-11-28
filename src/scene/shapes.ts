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

/** Nine microtubule triplets (27 tubules) in a pinwheel barrel, merged into a single draw call. */
export function centrioleGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const baseRadius = 0.032;
  const tubuleRadius = 0.0036;
  const barrelLen = 0.095;
  const bladeTilt = 0.62; // ~35 deg pinwheel tilt
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const cx = Math.cos(a) * baseRadius;
    const cz = Math.sin(a) * baseRadius;
    const tangentAngle = a + Math.PI / 2 + bladeTilt;
    const tx = Math.cos(tangentAngle);
    const tz = Math.sin(tangentAngle);
    for (let k = -1; k <= 1; k++) {
      const g = new THREE.CylinderGeometry(tubuleRadius, tubuleRadius, barrelLen, 6, 1, false);
      const offset = k * (tubuleRadius * 1.85);
      g.translate(cx + tx * offset, 0, cz + tz * offset);
      parts.push(g);
    }
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) throw new Error('centriole merge failed');
  merged.rotateX(Math.PI / 2);
  return merged;
}

/** A curved Golgi cisterna with dilated bulbous rims at the trans/cis ends. */
export function golgiCisternaGeometry(radius: number, arc: number, thickness: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.TorusGeometry(radius, thickness, 10, 56, arc);
  body.scale(1, 1, 0.38);
  body.rotateX(Math.PI / 2);
  parts.push(body);

  // Dilated bulbous rims at both ends of the cisterna
  for (const endAngle of [0, arc]) {
    const bulb = new THREE.SphereGeometry(thickness * 1.45, 10, 8);
    bulb.scale(1, 0.72, 1.15);
    bulb.translate(Math.cos(endAngle) * radius, 0, -Math.sin(endAngle) * radius);
    parts.push(bulb);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) throw new Error('golgi cisterna merge failed');
  return merged;
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

/** Alpha-helical transmembrane protein channel complex (5-helix bundle) for the plasma membrane. */
export function transmembraneChannelGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const helix = new THREE.CapsuleGeometry(0.0085, 0.032, 3, 6);
    helix.translate(Math.cos(a) * 0.014, 0, Math.sin(a) * 0.014);
    parts.push(helix);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) throw new Error('transmembrane channel merge failed');
  return merged;
}

/** Octagonal 3D Nuclear Pore Complex ring for the nuclear envelope. */
export function nuclearPoreGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const ring = new THREE.TorusGeometry(0.016, 0.0045, 6, 8);
  ring.rotateX(Math.PI / 2);
  parts.push(ring);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const spoke = new THREE.BoxGeometry(0.004, 0.006, 0.009);
    spoke.rotateY(-a);
    spoke.translate(Math.cos(a) * 0.011, 0, Math.sin(a) * 0.011);
    parts.push(spoke);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) throw new Error('nuclear pore merge failed');
  return merged;
}

/** Intertwined 3D chromatin (DNA/histone) fiber network inside the nucleus. */
export function chromatinNetworkGeometry(radius: number, strands: number, seed: number): THREE.BufferGeometry {
  const rng = makeRng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < strands; i++) {
    const pts: THREE.Vector3[] = [];
    let theta = rng() * Math.PI * 2;
    let phi = Math.acos(rng() * 2 - 1);
    let r = radius * (0.35 + rng() * 0.52);
    for (let k = 0; k < 7; k++) {
      pts.push(
        new THREE.Vector3(
          r * Math.sin(phi) * Math.cos(theta),
          r * Math.cos(phi),
          r * Math.sin(phi) * Math.sin(theta)
        )
      );
      theta += range(rng, -0.9, 0.9);
      phi = Math.max(0.25, Math.min(Math.PI - 0.25, phi + range(rng, -0.65, 0.65)));
      r = radius * (0.3 + rng() * 0.58);
    }
    parts.push(tubeGeometry(pts, 0.0095, 5, 22));
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) throw new Error('chromatin merge failed');
  return merged;
}

/**
 * Real 3D folded inner mitochondrial membrane (cristae) inside an ellipsoid of (rx, ry, rz).
 * Generates alternating invaginations (baffles) along the major X axis.
 */
export function mitochondrionCristaeGeometry(rx: number, ry: number, rz: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const irx = rx * 0.84;
  const iry = ry * 0.78;
  const irz = rz * 0.78;
  const baffles = 7;

  // Serpentine inner membrane spine + transverse cristae folds
  const spinePts: THREE.Vector3[] = [];
  const steps = baffles * 4;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = (u * 2 - 1) * irx * 0.88;
    const env = Math.sqrt(Math.max(0.05, 1 - (x / irx) * (x / irx)));
    const zWave = Math.sin(u * Math.PI * baffles) * irz * 0.72 * env;
    const yWave = Math.cos(u * Math.PI * baffles * 0.5) * iry * 0.18 * env;
    spinePts.push(new THREE.Vector3(x, yWave, zWave));
  }
  parts.push(tubeGeometry(spinePts, ry * 0.16, 6, 44));

  // Transverse cristae lamellae discs
  for (let i = 0; i < baffles; i++) {
    const u = (i + 0.5) / baffles;
    const x = (u * 2 - 1) * irx * 0.78;
    const env = Math.sqrt(Math.max(0.1, 1 - (x / irx) * (x / irx)));
    const disc = new THREE.CylinderGeometry(iry * 0.72 * env, iry * 0.72 * env, rx * 0.032, 12, 1);
    disc.rotateZ(Math.PI / 2);
    disc.scale(1, 0.85, 1.05);
    disc.translate(x, 0, (i % 2 === 0 ? 1 : -1) * irz * 0.12 * env);
    parts.push(disc);
  }

  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) throw new Error('cristae merge failed');
  return merged;
}

/**
 * Closed-volume, thickened 3D ER cisterna sheet (top + bottom + perimeter) so Rough ER reads
 * as real membrane sacs rather than paper-thin 1-sided ribbons.
 */
export function cisternaSheetGeometry(
  length: number,
  width: number,
  thickness = 0.024,
  opts: { segsX?: number; segsY?: number; waveAmp?: number; waveFreq?: number; bend?: number; seed?: number } = {}
): THREE.BufferGeometry {
  const segsX = opts.segsX ?? 32;
  const segsY = opts.segsY ?? 8;
  const waveAmp = opts.waveAmp ?? 0.05;
  const waveFreq = opts.waveFreq ?? 2.2;
  const bend = opts.bend ?? 0.08;
  const seed = opts.seed ?? 1;

  const base = ribbonGeometry(length, width, { segsX, segsY, waveAmp, waveFreq, bend, seed });
  const top = base.clone();
  top.translate(0, thickness * 0.5, 0);
  const bottom = base.clone();
  bottom.translate(0, -thickness * 0.5, 0);
  // Flip bottom winding so normals point outward
  const idx = bottom.getIndex();
  if (idx) {
    const arr = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const tmp = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = tmp;
    }
    idx.needsUpdate = true;
    bottom.computeVertexNormals();
  }
  base.dispose();

  const merged = mergeGeometries([top, bottom], false);
  top.dispose();
  bottom.dispose();
  if (!merged) throw new Error('cisterna sheet merge failed');
  return merged;
}

/** Realistic 80S eukaryotic ribosome: large 60S subunit + smaller 40S subunit. */
export function ribosome80SGeometry(): THREE.BufferGeometry {
  const large = new THREE.IcosahedronGeometry(0.0115, 1);
  large.scale(1.15, 0.9, 1.0);
  const small = new THREE.IcosahedronGeometry(0.008, 1);
  small.scale(1.05, 0.78, 0.95);
  small.translate(0, 0.011, 0.002);
  const merged = mergeGeometries([large, small], false);
  large.dispose();
  small.dispose();
  if (!merged) throw new Error('ribosome 80S merge failed');
  return merged;
}
