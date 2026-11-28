import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  boneLocalQuaternion,
  dampQuaternion,
  jointAngleErrorDegrees,
  palmBasis,
  palmDeltaQuaternion
} from '../../src/scene/handMath';
import type { Vec3 } from '../../src/types';

function makeFlatHand(mirrorX = false): Vec3[] {
  const s = mirrorX ? -1 : 1;
  const pts: Vec3[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  pts[0] = { x: 0, y: 0, z: 0 };
  pts[5] = { x: 0.04 * s, y: 0.08, z: 0 };
  pts[9] = { x: 0, y: 0.085, z: 0 };
  pts[17] = { x: -0.04 * s, y: 0.075, z: 0 };
  for (let i = 1; i <= 4; i++) pts[i] = { x: 0.03 * s + i * 0.01 * s, y: 0.02 + i * 0.015, z: 0 };
  for (let i = 6; i <= 8; i++) pts[i] = { x: 0.04 * s, y: 0.08 + (i - 5) * 0.025, z: 0 };
  for (let i = 10; i <= 12; i++) pts[i] = { x: 0, y: 0.085 + (i - 9) * 0.028, z: 0 };
  for (let i = 14; i <= 16; i++) pts[i] = { x: -0.02 * s, y: 0.08 + (i - 13) * 0.025, z: 0 };
  for (let i = 18; i <= 20; i++) pts[i] = { x: -0.04 * s, y: 0.075 + (i - 17) * 0.02, z: 0 };
  return pts;
}

describe('handMath', () => {
  it('builds an orthonormal right-handed palm basis for both left and right hands', () => {
    for (const mirror of [false, true]) {
      const basis = palmBasis(makeFlatHand(mirror));
      expect(basis.valid).toBe(true);
      expect(basis.x.length()).toBeCloseTo(1, 5);
      expect(basis.y.length()).toBeCloseTo(1, 5);
      expect(basis.z.length()).toBeCloseTo(1, 5);
      expect(basis.x.dot(basis.y)).toBeCloseTo(0, 5);
      expect(basis.y.dot(basis.z)).toBeCloseTo(0, 5);
      expect(basis.matrix.determinant()).toBeCloseTo(1, 5);
    }
  });

  it('returns identity delta quaternion for identical rest and live bases', () => {
    const rest = palmBasis(makeFlatHand(false));
    const live = palmBasis(makeFlatHand(false));
    const q = palmDeltaQuaternion(rest, live);
    expect(Math.abs(q.w)).toBeCloseTo(1, 5);
  });

  it('respects maxFlexRad soft anatomical clamp in boneLocalQuaternion', () => {
    const restDir = new THREE.Vector3(0, 1, 0);
    const restQuat = new THREE.Quaternion();
    const targetDir = new THREE.Vector3(0, -1, 0); // 180 deg away
    const q = boneLocalQuaternion(restDir, restQuat, targetDir, Math.PI / 3);
    const rotated = restDir.clone().applyQuaternion(q);
    const angle = restDir.angleTo(rotated);
    expect(angle).toBeCloseTo(Math.PI / 3, 3);
  });

  it('takes the shortest path in dampQuaternion even with negated hemisphere', () => {
    const cur = new THREE.Quaternion(0, 0, 0, 1);
    const target = new THREE.Quaternion(0, 0, 0, -1); // same orientation, opposite sign
    const out = dampQuaternion(cur, target, 20, 0.016);
    expect(Math.abs(out.w)).toBeCloseTo(1, 5);
  });

  it('computes zero joint angle error for identical poses', () => {
    const hand = makeFlatHand(false);
    expect(jointAngleErrorDegrees(hand, hand)).toBeCloseTo(0, 5);
  });
});
