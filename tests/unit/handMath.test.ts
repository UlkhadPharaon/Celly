import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  angleAt,
  boneLocalQuaternion,
  dampQuaternion,
  jointAngleErrorDegrees,
  palmBasis,
  palmDeltaQuaternion,
  signedAngle
} from '../../src/scene/handMath';
import type { Vec3 } from '../../src/types';

/** A plausible 21-point skeleton; only the palm-defining landmarks matter for the basis. */
function hand(reflectX = false): Vec3[] {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  points[0] = { x: 0, y: 0, z: 0 };
  points[9] = { x: 0, y: 0.09, z: 0 };
  points[5] = { x: -0.042, y: 0.062, z: 0 };
  points[17] = { x: 0.043, y: 0.055, z: 0 };
  if (reflectX) for (const p of points) p.x = -p.x;
  return points;
}

function rotateY(points: Vec3[], angle: number): Vec3[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return points.map((p) => ({ x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c }));
}

function expectUnit(v: THREE.Vector3): void {
  expect(v.length()).toBeCloseTo(1, 6);
  expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
}

describe('palmBasis', () => {
  it('is orthonormal, unit length and right-handed for both hands', () => {
    for (const reflected of [false, true]) {
      const basis = palmBasis(hand(reflected));
      expect(basis.valid).toBe(true);
      expectUnit(basis.x);
      expectUnit(basis.y);
      expectUnit(basis.z);
      expect(basis.x.dot(basis.y)).toBeCloseTo(0, 6);
      expect(basis.x.dot(basis.z)).toBeCloseTo(0, 6);
      expect(basis.y.dot(basis.z)).toBeCloseTo(0, 6);
      expect(basis.matrix.determinant()).toBeCloseTo(1, 6);
      expect(basis.quaternion.length()).toBeCloseTo(1, 6);
    }
  });

  it('produces a finite quaternion from mirrored landmarks (never a reflection)', () => {
    const right = palmBasis(hand(false));
    const left = palmBasis(hand(true));
    expect(left.quaternion.toArray().every(Number.isFinite)).toBe(true);
    expect(left.matrix.determinant()).toBeGreaterThan(0);
    expect(right.quaternion.toArray().every(Number.isFinite)).toBe(true);
  });

  it('falls back to identity rather than NaN on a degenerate palm', () => {
    const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
    const basis = palmBasis(points);
    expect(basis.valid).toBe(false);
    expect(basis.matrix.determinant()).toBe(1);
    expect(basis.quaternion.toArray().every(Number.isFinite)).toBe(true);
  });
});

describe('palmDeltaQuaternion', () => {
  it('is identity when rest and live palms match', () => {
    const basis = palmBasis(hand(false));
    const delta = palmDeltaQuaternion(basis, basis);
    expect(delta.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 6);
  });

  it('rotates the rest x axis onto the live x axis and keeps the wrist fixed', () => {
    const rest = palmBasis(hand(false));
    const live = palmBasis(rotateY(hand(false), 0.7));
    const delta = palmDeltaQuaternion(rest, live);
    const mapped = rest.x.clone().applyQuaternion(delta).normalize();
    expect(mapped.angleTo(live.x)).toBeCloseTo(0, 5);
    expect(delta.length()).toBeCloseTo(1, 6);
  });
});

describe('dampQuaternion', () => {
  it('takes the shortest arc when the target has the opposite quaternion sign', () => {
    const current = new THREE.Quaternion();
    const target = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 2.9);
    const flipped = new THREE.Quaternion(-target.x, -target.y, -target.z, -target.w);
    const a = dampQuaternion(current, target, 10, 0.05);
    const b = dampQuaternion(current, flipped, 10, 0.05);
    expect(a.angleTo(b)).toBeCloseTo(0, 5);
    expect(a.angleTo(target)).toBeLessThan(2.9);
  });

  it('is stable for a zero or negative dt', () => {
    const current = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
    const target = new THREE.Quaternion();
    const out = dampQuaternion(current, target, 20, 0);
    expect(out.angleTo(current)).toBeCloseTo(0, 6);
  });
});

describe('boneLocalQuaternion', () => {
  const restDir = new THREE.Vector3(0, 1, 0);
  const restQuat = new THREE.Quaternion();

  it('solves a local rotation that takes the rest direction to the target', () => {
    const target = new THREE.Vector3(1, 0, 0);
    const q = boneLocalQuaternion(restDir, restQuat, target);
    const mapped = restDir.clone().applyQuaternion(q).normalize();
    expect(mapped.angleTo(target)).toBeCloseTo(0, 5);
    expect(q.length()).toBeCloseTo(1, 6);
  });

  it('soft-limits flexion without introducing a singular quaternion', () => {
    const target = new THREE.Vector3(0, -1, 0);
    const limit = Math.PI / 6;
    const q = boneLocalQuaternion(restDir, restQuat, target, limit);
    const mapped = restDir.clone().applyQuaternion(q).normalize();
    expect(mapped.angleTo(restDir)).toBeCloseTo(limit, 5);
    expect(q.toArray().every(Number.isFinite)).toBe(true);
  });

  it('returns the rest rotation for a zero-length target', () => {
    const q = boneLocalQuaternion(restDir, restQuat, new THREE.Vector3(), 1);
    expect(q.equals(restQuat)).toBe(true);
  });

  it('preserves the rest twist when the target equals the rest direction', () => {
    const twist = new THREE.Quaternion().setFromAxisAngle(restDir, 0.35);
    const q = boneLocalQuaternion(restDir, twist, restDir.clone(), 1);
    expect(q.angleTo(twist)).toBeCloseTo(0, 6);
  });
});

describe('angle helpers', () => {
  it('computes bend angles and mean joint error unchanged by global rotation', () => {
    const a: Vec3[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
    a[0] = { x: 0, y: 0, z: 0 };
    a[5] = { x: 0, y: 1, z: 0 };
    a[6] = { x: 1, y: 1, z: 0 };
    const b = a.map((p) => ({ ...p }));
    b[6] = { x: 0, y: 2, z: 0 };
    expect(angleAt(a[0], a[5], a[6])).toBeCloseTo(Math.PI / 2, 6);
    const chain: Array<readonly [number, number, number]> = [[0, 5, 6]];
    expect(jointAngleErrorDegrees(a, b, chain)).toBeCloseTo(90, 4);

    const rotated = a.map((p) => ({ x: -p.y, y: p.x, z: p.z }));
    expect(jointAngleErrorDegrees(a, rotated, chain)).toBeCloseTo(0, 4);
  });

  it('reports a signed hinge angle', () => {
    const a = new THREE.Vector3(0, 1, 0);
    const b = new THREE.Vector3(1, 0, 0);
    expect(signedAngle(a, b, new THREE.Vector3(0, 0, -1))).toBeCloseTo(Math.PI / 2, 5);
    expect(signedAngle(a, b, new THREE.Vector3(0, 0, 1))).toBeCloseTo(-Math.PI / 2, 5);
  });
});
