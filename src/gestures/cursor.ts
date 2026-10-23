import type { Vec2, Vec3 } from '../types';
import { clamp } from '../core/math';

export interface ScreenMapping {
  width: number;
  height: number;
  mirrorX: boolean;
  mirrorY: boolean;
}

/**
 * Usable camera area. A webcam frame is wider than the space a person actually moves a hand in:
 * the outer 8 % is mostly sofa, doorframe and empty desk. Mapping the middle 84 % onto the whole
 * viewport gives a ~1.19x pointer gain and makes the screen edges reachable without leaning.
 */
export const REACH = { low: 0.08, high: 0.92 } as const;

/** Normalised camera coordinate → 0..1 screen fraction (clamped). */
export function reach(v: number): number {
  return clamp((v - REACH.low) / (REACH.high - REACH.low), 0, 1);
}

/** Inverse of `reach`, used to place synthetic hands exactly on a requested screen point. */
export function unreach(v: number): number {
  return REACH.low + clamp(v, 0, 1) * (REACH.high - REACH.low);
}

export function mapNormalized(p: Vec3, map: ScreenMapping): Vec2 {
  const nx = map.mirrorX ? 1 - p.x : p.x;
  const ny = map.mirrorY ? 1 - p.y : p.y;
  return { x: reach(nx) * map.width, y: reach(ny) * map.height };
}

export function toNDC(screen: Vec2, map: ScreenMapping): Vec2 {
  return {
    x: clamp((screen.x / map.width) * 2 - 1, -1, 1),
    y: clamp(-((screen.y / map.height) * 2 - 1), -1, 1)
  };
}

/** Pinch cursor = midpoint between thumb tip (4) and index tip (8). */
export function pinchCursor(landmarks: Vec3[], map: ScreenMapping): { cursor: Vec2; ndc: Vec2 } {
  const a = landmarks[4];
  const b = landmarks[8];
  const mid: Vec3 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  const cursor = mapNormalized(mid, map);
  return { cursor, ndc: toNDC(cursor, map) };
}

/** Palm point used for rotate deltas = middle MCP (9). */
export function palmPoint(landmarks: Vec3[], map: ScreenMapping): Vec2 {
  return mapNormalized(landmarks[9], map);
}

/** In-plane roll: angle of the index-MCP → pinky-MCP axis. */
export function handRoll(landmarks: Vec3[]): number {
  const a = landmarks[5];
  const b = landmarks[17];
  return Math.atan2(b.y - a.y, b.x - a.x);
}
