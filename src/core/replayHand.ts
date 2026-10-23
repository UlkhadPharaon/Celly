import type { HandSide, Vec3 } from '../types';

/**
 * Anatomically plausible synthetic hand used by the screenshot harness and the e2e specs.
 *
 * The real tracker needs a camera and a person; tests and docs still have to drive the whole
 * pipeline (pinch hysteresis, side resolution, rig retargeting, cursors). This module builds a
 * right/left hand with MediaPipe's 21-landmark topology, folds the thumb and index together to
 * the requested pinch value, and puts the pinch point exactly on the requested screen position,
 * so a synthetic hand behaves like a tracked one everywhere downstream.
 */

/** Metres from wrist to middle knuckle of the reference hand: the pinch denominator. */
const MIDDLE_KNUCKLE = 0.094;
/** Screen pixels per metre: 1 metre is 1.05 viewport heights, so a hand reads ~200 px tall. */
const PX_PER_METRE = 1.05;

interface Finger {
  /** Knuckle position in metres, hand-local (x right, y up, z towards the camera). */
  knuckle: [number, number];
  lengths: [number, number, number];
  /** Outward fan from vertical, radians. */
  fan: number;
}

const FINGERS: Finger[] = [
  { knuckle: [-0.030, 0.088], lengths: [0.038, 0.024, 0.019], fan: -0.17 },
  { knuckle: [-0.004, MIDDLE_KNUCKLE], lengths: [0.042, 0.027, 0.02], fan: -0.04 },
  { knuckle: [0.022, 0.09], lengths: [0.038, 0.025, 0.019], fan: 0.09 },
  { knuckle: [0.044, 0.08], lengths: [0.03, 0.02, 0.016], fan: 0.21 }
];

const THUMB_BASE: [number, number, number] = [-0.027, 0.024, 0.014];
const THUMB_SEGMENTS: Array<[number, number, number]> = [
  [-0.021, 0.031, 0.005],
  [-0.014, 0.027, 0.007],
  [-0.009, 0.023, 0.005]
];

export interface SynthHand {
  /** Normalised image landmarks (0..1), MediaPipe order. */
  landmarks: Vec3[];
  /** Metric hand-local landmarks, wrist at the origin, MediaPipe order. */
  world: Vec3[];
  handScale: number;
  palm: { x: number; y: number };
  roll: number;
}

/**
 * @param x  pinch point in CSS pixels
 * @param y  pinch point in CSS pixels
 * @param pinch 0 = open, 1 = thumb and index touching
 */
export function synthHand(
  side: HandSide,
  x: number,
  y: number,
  pinch: number,
  viewport: { width: number; height: number }
): SynthHand {
  const p = Math.min(1, Math.max(0, pinch));
  const points = buildHand();

  // Fold the thumb and index towards their common midpoint. The tips travel almost all the way
  // (0.98) so a pinch of 0.96 leaves a realistic ~4 mm gap instead of degenerate zero-length
  // bones, which would break the direction-based retargeting.
  const mid = midpoint(points[4], points[8]);
  const curve = [0.45, 0.78, 0.98];
  for (let k = 0; k < 3; k++) {
    blend(points, 6 + k, mid, p * curve[k]); // index PIP / DIP / TIP
    blend(points, 2 + k, mid, p * curve[k]); // thumb MCP / IP / TIP
  }

  // Mirror for a left hand so the thumb sits on the other side.
  if (side === 'left') for (const point of points) point.x = -point.x;

  // Put the pinch point on the requested screen position.
  const pinchPoint = midpoint(points[4], points[8]);
  const scale = viewport.height * PX_PER_METRE;
  const toPixels = (point: Vec3): { x: number; y: number } => ({
    x: x + (point.x - pinchPoint.x) * scale,
    y: y - (point.y - pinchPoint.y) * scale
  });

  const landmarks = points.map((point) => {
    const px = toPixels(point);
    return {
      x: px.x / viewport.width,
      y: px.y / viewport.height,
      z: ((point.z - pinchPoint.z) * scale) / viewport.width
    };
  });

  const world = points.map((point) => ({
    x: point.x - pinchPoint.x,
    y: point.y - pinchPoint.y,
    z: point.z - pinchPoint.z
  }));

  const wrist = toPixels(points[0]);
  const palmCentre = toPixels(points[9]);
  const roll = Math.atan2(palmCentre.y - wrist.y, palmCentre.x - wrist.x) + Math.PI / 2;

  return {
    landmarks,
    world,
    handScale: Math.hypot(world[9].x - world[0].x, world[9].y - world[0].y, world[9].z - world[0].z),
    palm: {
      x: (wrist.x + palmCentre.x) / 2,
      y: (wrist.y + palmCentre.y) / 2
    },
    roll
  };
}

function buildHand(): Vec3[] {
  const points: Vec3[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  points[0] = { x: 0, y: 0, z: 0 };

  FINGERS.forEach((finger, i) => {
    let px = finger.knuckle[0];
    let py = finger.knuckle[1];
    let pz = 0.006;
    const mcp = 5 + i * 4;
    points[mcp] = { x: px, y: py, z: pz };
    for (let s = 0; s < 3; s++) {
      const angle = finger.fan * (1 + s * 0.35);
      const length = finger.lengths[s];
      px += Math.sin(angle) * length;
      py += Math.cos(angle) * length;
      pz += 0.1 * length * (1 + s);
      points[mcp + 1 + s] = { x: px, y: py, z: pz };
    }
  });

  points[1] = { x: THUMB_BASE[0], y: THUMB_BASE[1], z: THUMB_BASE[2] };
  let tx = THUMB_BASE[0];
  let ty = THUMB_BASE[1];
  let tz = THUMB_BASE[2];
  THUMB_SEGMENTS.forEach((segment, i) => {
    tx += segment[0];
    ty += segment[1];
    tz += segment[2];
    points[2 + i] = { x: tx, y: ty, z: tz };
  });

  return points;
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function blend(points: Vec3[], index: number, target: Vec3, amount: number): void {
  const point = points[index];
  point.x += (target.x - point.x) * amount;
  point.y += (target.y - point.y) * amount;
  point.z += (target.z - point.z) * amount;
}
