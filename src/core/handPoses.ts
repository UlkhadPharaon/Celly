import type { HandSide, Vec3 } from '../types';
import { synthHand } from './replayHand';
import { unreach } from '../gestures/cursor';

/**
 * Deterministic landmark generator for the hand pose suite.
 *
 * These are not camera recordings. They are anatomically plausible 21-point MediaPipe skeletons
 * built from the same synthetic hand the e2e harness uses, then posed (curl, spread, roll) and
 * projected with the production mirror/reach mapping. Keeping them in one place makes visual
 * regressions reproducible without a webcam, and the JSON fixtures in tests/fixtures/hand-poses
 * are snapshots of this generator for replay in other tools.
 */

export type PoseName =
  | 'open'
  | 'fist'
  | 'pinch'
  | 'point'
  | 'peace'
  | 'thumbs-up'
  | 'ok'
  | 'spread'
  | 'wiggle'
  | 'wrist-rotation-slow'
  | 'palm'
  | 'back'
  | 'fast-movement';

export interface PoseData {
  name: PoseName;
  side: HandSide;
  /** Display-space cursor (thumb/index midpoint) in CSS pixels. */
  cursor: { x: number; y: number };
  wrist: { x: number; y: number };
  palm: { x: number; y: number };
  roll: number;
  /** Wrist â†’ middle MCP span in viewport-height units. */
  handSpan: number;
  /** Pre-mirror, pre-reach normalised landmarks, exactly what the tracker publishes. */
  landmarks: Vec3[];
  /** Wrist-centred world landmarks in metres, y-up, z toward the camera. */
  world: Vec3[];
  pinch: number;
  pinching: boolean;
}

const PX_PER_METRE = 1.05;

export function buildPose(
  name: PoseName,
  side: HandSide,
  x: number,
  y: number,
  viewport: { width: number; height: number },
  mirror: { mirrorX: boolean; mirrorY: boolean },
  phase = 0
): PoseData {
  const nx = unreach(x / viewport.width);
  const ny = unreach(y / viewport.height);
  const synthetic = synthHand(
    side,
    (mirror.mirrorX ? 1 - nx : nx) * viewport.width,
    (mirror.mirrorY ? 1 - ny : ny) * viewport.height,
    0,
    viewport
  );

  // synthHand.world is centred on the pinch midpoint. Move it to the wrist, which is the only
  // origin the rig is allowed to rotate around.
  const wristWorld = synthetic.world[0];
  let world: Vec3[] = synthetic.world.map((p) => ({
    x: p.x - wristWorld.x,
    y: p.y - wristWorld.y,
    z: p.z - wristWorld.z
  }));

  let pinch = 0;
  switch (name) {
    case 'open':
      break;
    case 'fist':
      for (const mcp of [5, 9, 13, 17]) curlChain(world, mcp, [1.25, 1.5, 0.9]);
      curlThumb(world, 0.8);
      break;
    case 'pinch':
      pinch = 1;
      world = foldPinch(world, 0.96);
      break;
    case 'point':
      curlChain(world, 5, [0.08, 0.12, 0.06]);
      curlChain(world, 9, [1.18, 1.45, 0.82]);
      curlChain(world, 13, [1.18, 1.45, 0.82]);
      curlChain(world, 17, [1.12, 1.4, 0.78]);
      curlThumb(world, 0.5);
      break;
    case 'peace':
      curlChain(world, 5, [0.06, 0.1, 0.05]);
      curlChain(world, 9, [0.06, 0.1, 0.05]);
      curlChain(world, 13, [1.12, 1.4, 0.8]);
      curlChain(world, 17, [1.12, 1.4, 0.8]);
      curlThumb(world, 0.4);
      break;
    case 'thumbs-up':
      for (const mcp of [5, 9, 13, 17]) curlChain(world, mcp, [1.22, 1.5, 0.9]);
      extendThumbUp(world);
      break;
    case 'ok':
      pinch = 0.9;
      world = foldPinch(world, 0.9);
      break;
    case 'spread':
      spreadFingers(world);
      break;
    case 'wiggle':
      wiggle(world, phase);
      break;
    case 'wrist-rotation-slow':
      rollWorld(world, phase);
      break;
    case 'palm':
      break;
    case 'back':
      rollWorld(world, Math.PI);
      break;
    case 'fast-movement':
      rollWorld(world, phase * 0.35);
      break;
    default:
      break;
  }

  const pinchPoint = midpoint(world[4], world[8]);
  const scale = viewport.height * PX_PER_METRE;
  const toScreen = (p: Vec3) => ({
    x: x + (p.x - pinchPoint.x) * scale,
    y: y - (p.y - pinchPoint.y) * scale
  });

  const landmarks = world.map((p) => {
    const screen = toScreen(p);
    const preX = mirror.mirrorX ? 1 - unreach(screen.x / viewport.width) : unreach(screen.x / viewport.width);
    const preY = mirror.mirrorY ? 1 - unreach(screen.y / viewport.height) : unreach(screen.y / viewport.height);
    return {
      x: preX,
      y: preY,
      z: ((p.z - pinchPoint.z) * scale) / viewport.width
    };
  });

  const wristScreen = toScreen(world[0]);
  const palmScreen = toScreen(world[9]);
  const roll = Math.atan2(palmScreen.y - wristScreen.y, palmScreen.x - wristScreen.x) + Math.PI / 2;
  return {
    name,
    side,
    cursor: { x, y },
    wrist: wristScreen,
    palm: { x: (wristScreen.x + palmScreen.x) / 2, y: (wristScreen.y + palmScreen.y) / 2 },
    roll,
    handSpan: Math.hypot(palmScreen.x - wristScreen.x, palmScreen.y - wristScreen.y) / viewport.height,
    landmarks,
    world,
    pinch,
    pinching: name === 'pinch' || name === 'ok'
  };
}

export function buildPoseSequence(
  name: PoseName,
  side: HandSide,
  x: number,
  y: number,
  viewport: { width: number; height: number },
  mirror: { mirrorX: boolean; mirrorY: boolean }
): PoseData[] {
  if (name === 'wrist-rotation-slow') {
    return Array.from({ length: 13 }, (_, i) =>
      buildPose(name, side, x, y, viewport, mirror, -1.25 + (i / 12) * 2.5)
    );
  }
  if (name === 'wiggle') {
    return Array.from({ length: 13 }, (_, i) =>
      buildPose(name, side, x, y, viewport, mirror, (i / 12) * Math.PI * 2)
    );
  }
  if (name === 'fast-movement') {
    return Array.from({ length: 13 }, (_, i) => {
      const t = i / 12;
      return buildPose(
        name,
        side,
        x - 280 + t * 560,
        y + Math.sin(t * Math.PI * 2) * 90,
        viewport,
        mirror,
        t * Math.PI * 2
      );
    });
  }
  return [buildPose(name, side, x, y, viewport, mirror)];
}

function curlThumb(world: Vec3[], amount: number): void {
  curlChain(world, 1, [0.65 * amount, 0.85 * amount, 0.55 * amount]);
}

/**
 * Forward-kinematic curl: rotate each successive segment around the across-palm axis toward the
 * palm. This produces real joint-angle changes (a fist is not just a shorter straight finger), so
 * the retargeter actually has to bend the mesh.
 */
function curlChain(world: Vec3[], mcp: number, angles: number[]): void {
  const lengths: number[] = [];
  for (let s = 0; s < 3; s++) {
    const a = world[mcp + s];
    const b = world[mcp + s + 1];
    lengths.push(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  const base = world[mcp];
  let dir = normalize({
    x: world[mcp + 1].x - base.x,
    y: world[mcp + 1].y - base.y,
    z: world[mcp + 1].z - base.z
  });
  const p = { ...base };
  // The synthetic palm faces +Z for both hands. Rotating +Y toward +Z is a positive X rotation.
  for (let s = 0; s < 3; s++) {
    dir = rotateX(dir, angles[s]);
    p.x += dir.x * lengths[s];
    p.y += dir.y * lengths[s];
    p.z += dir.z * lengths[s];
    world[mcp + s + 1] = { ...p };
  }
}

function rotateX(p: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
}

function normalize(p: Vec3): Vec3 {
  const l = Math.hypot(p.x, p.y, p.z) || 1;
  return { x: p.x / l, y: p.y / l, z: p.z / l };
}

/** Fold the thumb and index toward their common midpoint, matching the pinch metric. */
function foldPinch(world: Vec3[], amount: number): Vec3[] {
  const next = world.map((p) => ({ ...p }));
  const mid = midpoint(next[4], next[8]);
  const curve = [0.45, 0.78, 0.98];
  for (let k = 0; k < 3; k++) {
    blend(next, 6 + k, mid, amount * curve[k]);
    blend(next, 2 + k, mid, amount * curve[k]);
  }
  return next;
}

function blend(points: Vec3[], index: number, target: Vec3, amount: number): void {
  const point = points[index];
  point.x += (target.x - point.x) * amount;
  point.y += (target.y - point.y) * amount;
  point.z += (target.z - point.z) * amount;
}

function extendThumbUp(world: Vec3[]): void {
  world[1] = { x: -0.031, y: 0.026, z: 0.012 };
  world[2] = { x: -0.034, y: 0.062, z: 0.014 };
  world[3] = { x: -0.031, y: 0.103, z: 0.014 };
  world[4] = { x: -0.027, y: 0.142, z: 0.012 };
}

function spreadFingers(world: Vec3[]): void {
  for (const mcp of [5, 9, 13, 17]) {
    const base = world[mcp];
    for (let s = 1; s <= 3; s++) {
      const p = world[mcp + s];
      world[mcp + s] = {
        x: base.x + (p.x - base.x) * 1.75,
        y: base.y + (p.y - base.y) * 0.96,
        z: p.z
      };
    }
  }
}

function wiggle(world: Vec3[], phase: number): void {
  for (let f = 0; f < 4; f++) {
    const mcp = 5 + f * 4;
    const wave = Math.sin(phase + f * 0.9);
    for (let s = 2; s <= 3; s++) {
      const p = world[mcp + s];
      world[mcp + s] = {
        x: p.x + wave * 0.009 * (s - 1),
        y: p.y + Math.abs(wave) * 0.006 * (s - 1),
        z: p.z + wave * 0.01 * (s - 1)
      };
    }
  }
  // Thumb waves in opposition.
  const wave = Math.sin(phase + Math.PI);
  for (let i = 2; i <= 4; i++) {
    const p = world[i];
    world[i] = { x: p.x + wave * 0.006 * (i - 1), y: p.y, z: p.z + wave * 0.008 * (i - 1) };
  }
}

/** Roll the hand around the wristâ†’middle-MCP axis (the forearm/finger axis). */
function rollWorld(world: Vec3[], angle: number): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (const p of world) {
    const x = p.x * c + p.z * s;
    const z = -p.x * s + p.z * c;
    p.x = x;
    p.z = z;
  }
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

/** Replay frame shape stored in tests/fixtures/hand-poses. */
export interface PoseReplay {
  name: PoseName;
  side: HandSide;
  viewport: { width: number; height: number };
  frames: PoseData[];
}
