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
const _basisMatrix = new THREE.Matrix4();

/** Allocate a reusable palm basis for hot paths such as `HandRig.apply`. */
export function createPalmBasis(): PalmBasis {
  return {
    x: new THREE.Vector3(1, 0, 0),
    y: new THREE.Vector3(0, 1, 0),
    z: new THREE.Vector3(0, 0, 1),
    matrix: new THREE.Matrix3(),
    quaternion: new THREE.Quaternion(),
    valid: false
  };
}

export function palmBasis(points: Vec3[]): PalmBasis {
  return palmBasisInto(points, createPalmBasis());
}

/** Out-parameter variant: no allocations once the target basis exists. */
export function palmBasisInto(points: Vec3[], out: PalmBasis): PalmBasis {
  const wrist = points[0];
  const middle = points[9];
  const index = points[5];
  const pinky = points[17];
  if (!wrist || !middle || !index || !pinky) return resetFallback(out);

  const z = out.z.set(middle.x - wrist.x, middle.y - wrist.y, middle.z - wrist.z);
  if (z.lengthSq() < 1e-10) return resetFallback(out);
  z.normalize();

  const x = out.x.set(index.x - pinky.x, index.y - pinky.y, index.z - pinky.z);
  x.addScaledVector(z, -x.dot(z));
  if (x.lengthSq() < 1e-10) {
    // Degenerate index/pinky spread: pick any axis perpendicular to the palm direction. This
    // only happens on a corrupt landmark frame; keeping a valid rotation beats publishing NaN.
    x.crossVectors(z, Math.abs(z.y) < 0.9 ? Y_FALLBACK : X_FALLBACK);
  }
  x.normalize();

  const y = out.y.crossVectors(z, x).normalize();
  // Re-orthogonalise x after the second cross product so round-off cannot tilt the matrix.
  x.crossVectors(y, z).normalize();

  out.matrix.set(x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z);
  out.quaternion.setFromRotationMatrix(_basisMatrix.setFromMatrix3(out.matrix));
  out.valid = true;
  return out;
}

function resetFallback(out: PalmBasis): PalmBasis {
  out.x.copy(X_FALLBACK);
  out.y.copy(Y_FALLBACK);
  out.z.copy(Z_FALLBACK);
  out.matrix.identity();
  out.quaternion.identity();
  out.valid = false;
  return out;
}

/** Backwards-compatible matrix-only helper used by older debug tooling. */
export function frameFrom(points: Vec3[]): THREE.Matrix3 {
  return palmBasis(points).matrix;
}

/** Scratch objects keep the per-frame hand solver allocation-free. */
const _delta = new THREE.Quaternion();
const _goal = new THREE.Quaternion();
const _restInv = new THREE.Quaternion();
const _restDir = new THREE.Vector3();
const _targetDir = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _cb = new THREE.Vector3();

/**
 * World-space rotation that takes the rig's rest palm basis to the live palm basis.
 *
 * `q = live * inverse(rest)` is the same as `root.quaternion = palmQuaternion * inverse(restPose)`.
 * It is applied to a pivot at the wrist, so neither the wrist nor the mesh translates while the
 * hand turns.
 */
export function palmDeltaQuaternion(
  rest: PalmBasis,
  live: PalmBasis,
  out = new THREE.Quaternion()
): THREE.Quaternion {
  _restInv.copy(rest.quaternion).invert();
  return out.copy(live.quaternion).multiply(_restInv).normalize();
}

/** Shortest-path slerp with an exponential time constant. Never flips through 360 degrees. */
export function dampQuaternion(
  current: THREE.Quaternion,
  target: THREE.Quaternion,
  rate: number,
  dt: number,
  out = new THREE.Quaternion()
): THREE.Quaternion {
  const t = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, Math.min(0.1, dt)));
  _goal.copy(target);
  if (current.dot(_goal) < 0) _goal.set(-_goal.x, -_goal.y, -_goal.z, -_goal.w);
  return out.copy(current).slerp(_goal, t).normalize();
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
  maxFlexRad = Math.PI,
  out = new THREE.Quaternion()
): THREE.Quaternion {
  const rest = _restDir.copy(restDirParent).normalize();
  const target = _targetDir.copy(targetDirParent);
  if (target.lengthSq() < 1e-10) return out.copy(restQuat);
  target.normalize();

  const dot = THREE.MathUtils.clamp(rest.dot(target), -1, 1);
  let angle = Math.acos(dot);
  if (!Number.isFinite(angle) || angle < 1e-5) return out.copy(restQuat);

  const maxFlex = Math.max(0, Math.min(Math.PI, maxFlexRad));
  if (angle > maxFlex) {
    // Slerp the direction toward the rest direction, not the quaternion, so the soft limit
    // still produces a valid direction and never a singular antiparallel cross product.
    const t = maxFlex / angle;
    target.copy(rest).lerp(target, t).normalize();
    angle = maxFlex;
  }

  const axis = _axis.crossVectors(rest, target);
  if (axis.lengthSq() < 1e-10) {
    // Exactly antiparallel: pick a stable axis perpendicular to the rest direction.
    axis.crossVectors(rest, Math.abs(rest.y) < 0.9 ? Y_FALLBACK : X_FALLBACK);
  }
  axis.normalize();
  _delta.setFromAxisAngle(axis, angle);
  return out.copy(_delta).multiply(restQuat).normalize();
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
  _ab.set(a.x - b.x, a.y - b.y, a.z - b.z);
  _cb.set(c.x - b.x, c.y - b.y, c.z - b.z);
  if (_ab.lengthSq() < 1e-12 || _cb.lengthSq() < 1e-12) return 0;
  return _ab.angleTo(_cb);
}

/** Parent → joint → child triples used for finger-angle comparison. */
export const DEFAULT_CHAINS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2], [1, 2, 3], [2, 3, 4],
  [0, 5, 6], [5, 6, 7], [6, 7, 8],
  [0, 9, 10], [9, 10, 11], [10, 11, 12],
  [0, 13, 14], [13, 14, 15], [14, 15, 16],
  [0, 17, 18], [17, 18, 19], [18, 19, 20]
];
