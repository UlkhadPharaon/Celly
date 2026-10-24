import * as THREE from 'three';
import type { Vec3 } from '../types';

/**
 * Palm-space math shared by the rig and the unit tests.
 *
 * The basis is deliberately built from the *same ordered landmarks* as the rig rest pose:
 *   x = index MCP (5) - pinky MCP (17)
 *   z = wrist (0) -> middle MCP (9)
 *   y = z x x (Gram-Schmidt)
 *
 * The cross product guarantees a right-handed rotation matrix even when the two hands are
 * mirror images of each other. A reflection can never reach `Quaternion.setFromRotationMatrix`.
 */
export interface PalmBasis {
  x: THREE.Vector3;
  y: THREE.Vector3;
  z: THREE.Vector3;
  matrix: THREE.Matrix3;
  quaternion: THREE.Quaternion;
  valid: boolean;
}

const X_FALLBACK = new THREE.Vector3(1, 0, 0);
const Y_FALLBACK = new THREE.Vector3(0, 1, 0);
const Z_FALLBACK = new THREE.Vector3(0, 0, 1);

export function palmBasis(points: Vec3[]): PalmBasis {
  const wrist = points[0];
  const middle = points[9];
  const index = points[5];
  const pinky = points[17];
  if (!wrist || !middle || !index || !pinky) return fallbackBasis();

  const z = new THREE.Vector3(middle.x - wrist.x, middle.y - wrist.y, middle.z - wrist.z);
  if (z.lengthSq() < 1e-10) return fallbackBasis();
  z.normalize();

  const x = new THREE.Vector3(index.x - pinky.x, index.y - pinky.y, index.z - pinky.z);
  x.addScaledVector(z, -x.dot(z));
  if (x.lengthSq() < 1e-10) {
    // Degenerate index/pinky spread: pick any axis perpendicular to the palm direction. This
    // only happens on a corrupt landmark frame; keeping a valid rotation beats publishing NaN.
    x.crossVectors(z, Math.abs(z.y) < 0.9 ? Y_FALLBACK : X_FALLBACK);
  }
  x.normalize();

  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  // Re-orthogonalise x after the second cross product so round-off cannot tilt the matrix.
  x.crossVectors(y, z).normalize();

  const matrix = new THREE.Matrix3().set(x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().setFromMatrix3(matrix));
  return { x, y, z, matrix, quaternion, valid: true };
}

function fallbackBasis(): PalmBasis {
  const matrix = new THREE.Matrix3().set(1, 0, 0, 0, 1, 0, 0, 0, 1);
  return {
    x: X_FALLBACK.clone(),
    y: Y_FALLBACK.clone(),
    z: Z_FALLBACK.clone(),
    matrix,
    quaternion: new THREE.Quaternion(),
    valid: false
  };
}

/** Backwards-compatible matrix-only helper used by older debug tooling. */
export function frameFrom(points: Vec3[]): THREE.Matrix3 {
  return palmBasis(points).matrix;
}

/**
 * World-space rotation that takes the rig's rest palm basis to the live palm basis.
 *
 * `q = live * inverse(rest)` is the same as `root.quaternion = palmQuaternion * inverse(restPose)`.
 * It is applied to a pivot at the wrist, so neither the wrist nor the mesh translates while the
 * hand turns.
 */
export function palmDeltaQuaternion(rest: PalmBasis, live: PalmBasis): THREE.Quaternion {
  return live.quaternion.clone().multiply(rest.quaternion.clone().invert()).normalize();
}

/** Shortest-path slerp with an exponential time constant. Never flips through 360 degrees. */
export function dampQuaternion(
  current: THREE.Quaternion,
  target: THREE.Quaternion,
  rate: number,
  dt: number
): THREE.Quaternion {
  const t = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, Math.min(0.1, dt)));
  const goal = target.clone();
  if (current.dot(goal) < 0) goal.set(-goal.x, -goal.y, -goal.z, -goal.w);
  return current.clone().slerp(goal, t).normalize();
}

/**
 * Minimal local rotation taking a bone from its rest direction to a target direction.
 * The rotation axis is perpendicular to the rest direction, so the bone's inherited twist is
 * preserved (no candy-wrapper). The bend is softly limited to `maxFlexRad`.
 */
export function boneLocalQuaternion(
  restDirParent: THREE.Vector3,
  restQuat: THREE.Quaternion,
  targetDirParent: THREE.Vector3,
  maxFlexRad = Math.PI
): THREE.Quaternion {
  const rest = restDirParent.clone().normalize();
  const target = targetDirParent.clone();
  if (target.lengthSq() < 1e-10) return restQuat.clone();
  target.normalize();

  const dot = THREE.MathUtils.clamp(rest.dot(target), -1, 1);
  let angle = Math.acos(dot);
  if (!Number.isFinite(angle) || angle < 1e-5) return restQuat.clone();

  const maxFlex = Math.max(0, Math.min(Math.PI, maxFlexRad));
  if (angle > maxFlex) {
    // Slerp the direction toward the rest direction, not the quaternion, so the soft limit
    // still produces a valid direction and never a singular antiparallel cross product.
    const t = maxFlex / angle;
    target.copy(rest).lerp(target, t).normalize();
    angle = maxFlex;
  }

  const axis = new THREE.Vector3().crossVectors(rest, target);
  if (axis.lengthSq() < 1e-10) {
    // Exactly antiparallel: pick a stable axis perpendicular to the rest direction.
    axis.crossVectors(rest, Math.abs(rest.y) < 0.9 ? Y_FALLBACK : X_FALLBACK);
  }
  axis.normalize();
  const delta = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  return delta.multiply(restQuat).normalize();
}

/** Signed angle between two directions around a hinge axis, in radians. */
export function signedAngle(a: THREE.Vector3, b: THREE.Vector3, hinge: THREE.Vector3): number {
  const cross = new THREE.Vector3().crossVectors(a, b);
  return Math.atan2(cross.dot(hinge), THREE.MathUtils.clamp(a.dot(b), -1, 1));
}

/** Mean absolute joint-angle error in degrees between two 21-point skeletons. */
export function jointAngleErrorDegrees(
  a: Vec3[],
  b: Vec3[],
  chains: ReadonlyArray<readonly [number, number, number]> = DEFAULT_CHAINS
): number {
  if (a.length < 21 || b.length < 21) return 0;
  let sum = 0;
  let count = 0;
  for (const [parent, joint, child] of chains) {
    const aa = angleAt(a[parent], a[joint], a[child]);
    const bb = angleAt(b[parent], b[joint], b[child]);
    if (!Number.isFinite(aa) || !Number.isFinite(bb)) continue;
    sum += Math.abs(aa - bb);
    count++;
  }
  return count ? (sum / count) * (180 / Math.PI) : 0;
}

export function angleAt(a: Vec3, b: Vec3, c: Vec3): number {
  const ab = new THREE.Vector3(a.x - b.x, a.y - b.y, a.z - b.z);
  const cb = new THREE.Vector3(c.x - b.x, c.y - b.y, c.z - b.z);
  if (ab.lengthSq() < 1e-12 || cb.lengthSq() < 1e-12) return 0;
  return ab.angleTo(cb);
}

/** Parent → joint → child triples used for finger-angle comparison. */
export const DEFAULT_CHAINS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2], [1, 2, 3], [2, 3, 4],
  [0, 5, 6], [5, 6, 7], [6, 7, 8],
  [0, 9, 10], [9, 10, 11], [10, 11, 12],
  [0, 13, 14], [13, 14, 15], [14, 15, 16],
  [0, 17, 18], [17, 18, 19], [18, 19, 20]
];
