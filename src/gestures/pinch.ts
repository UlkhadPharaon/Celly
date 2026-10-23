import type { Vec3 } from '../types';
import { clamp, dist2, dist3 } from '../core/math';

export interface PinchConfig {
  /** Enter pinch above this value (1 = fully pinched). */
  enter: number;
  /** Release below this value (hysteresis band). */
  exit: number;
  /** Minimum time above `enter` before the pinch becomes active. */
  minHoldMs: number;
}

/**
 * Real hands never bring landmark 4 and 8 to zero distance: the pads touch while the marker
 * centres stay a couple of centimetres apart, and MediaPipe's metric z is noisy at arm's length.
 * The value is therefore a dead-zoned smoothstep over tip distance / palm width, not 1 - ratio.
 */
export const DEFAULT_PINCH: PinchConfig = { enter: 0.55, exit: 0.38, minHoldMs: 70 };

/** Tip-gap / palm-width ratio at which the pinch reads 1 and 0 respectively. */
export const PINCH_RATIO = { touch: 0.1, open: 0.55 } as const;

export const PINCH_SENSITIVITY = { min: 0.7, max: 1.5, firm: 0.8, normal: 1, light: 1.3 } as const;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export interface PinchState {
  active: boolean;
  /** Raw 0..1 pinch value. */
  value: number;
  /** Timestamp when the current candidate pinch crossed `enter`, or -1 when idle. */
  candidateSince: number;
  /** Timestamp of the last state change (for debounce/debug). */
  changedAt: number;
}

export function initialPinch(): PinchState {
  return { active: false, value: 0, candidateSince: -1, changedAt: 0 };
}

export interface PinchUpdate {
  state: PinchState;
  start: boolean;
  end: boolean;
}

/**
 * Thumb-tip (4) to index-tip (8) distance over palm width (MCP 5 → MCP 17).
 *
 * Palm width is the stable local scale of a hand: unlike wrist → middle MCP it does not change
 * when the wrist flexes, and unlike a raw distance it survives the hand moving towards or away
 * from the camera. The image-space ratio is the primary signal because metric z at arm's length
 * is the noisiest axis MediaPipe reports; world landmarks are folded in only when they agree with
 * the image, which denoises the value without letting a bad z reading break the gesture.
 *
 * `sensitivity` scales both ends of the mapping: below 1 needs a tighter pinch (Firm), above 1
 * accepts a looser one (Light). Defaults reproduce PINCH_RATIO exactly.
 */
export function pinchValue(landmarks: Vec3[], world: Vec3[], sensitivity = 1): number {
  if (landmarks.length < 21) return 0;
  const palm2 = dist2(landmarks[5], landmarks[17]);
  if (palm2 < 1e-5) return 0;

  const ratio2 = dist2(landmarks[4], landmarks[8]) / palm2;
  let ratio = ratio2;

  if (world.length === 21) {
    const palm3 = dist3(world[5], world[17]);
    if (palm3 > 1e-5) {
      const ratio3 = dist3(world[4], world[8]) / palm3;
      // A hand angled to the camera foreshortens both distances together, so a small gap between
      // the two ratios is trustworthy. A large one means z is lying — keep the 2D value.
      if (Number.isFinite(ratio3) && Math.abs(ratio3 - ratio2) <= 0.18) {
        ratio = (ratio2 + ratio3) / 2;
      }
    }
  }

  const k = clamp(sensitivity, PINCH_SENSITIVITY.min, PINCH_SENSITIVITY.max);
  return clamp(1 - smoothstep(PINCH_RATIO.touch * k, PINCH_RATIO.open * k, ratio), 0, 1);
}

/**
 * A fist is not a pinch: if three or more non-thumb fingertips sit closer to the wrist
 * than their own MCP, the hand is closed and pinch must not fire.
 */
export function isFist(landmarks: Vec3[]): boolean {
  if (landmarks.length < 21) return false;
  const wrist = landmarks[0];
  const pairs: Array<[number, number]> = [
    [8, 5],
    [12, 9],
    [16, 13],
    [20, 17]
  ];
  let curled = 0;
  for (const [tip, mcp] of pairs) {
    if (dist2(landmarks[tip], wrist) < dist2(landmarks[mcp], wrist) * 1.02) curled++;
  }
  return curled >= 3;
}

/**
 * Hysteresis state machine for one hand.
 * Enter above `enter`, leave below `exit`, and require `minHoldMs` above `enter`.
 */
export function updatePinch(
  prev: PinchState,
  value: number,
  opts: { fist: boolean; valid: boolean; tMs: number },
  cfg: PinchConfig = DEFAULT_PINCH
): PinchUpdate {
  const state: PinchState = { ...prev, value };

  if (!opts.valid || opts.fist) {
    const end = state.active;
    state.active = false;
    state.candidateSince = -1;
    if (end) state.changedAt = opts.tMs;
    return { state, start: false, end };
  }

  if (state.active) {
    if (value < cfg.exit) {
      state.active = false;
      state.changedAt = opts.tMs;
      state.candidateSince = -1;
      return { state, start: false, end: true };
    }
    return { state, start: false, end: false };
  }

  if (value > cfg.enter) {
    if (state.candidateSince < 0) {
      state.candidateSince = opts.tMs;
    }
    if (opts.tMs - state.candidateSince >= cfg.minHoldMs) {
      state.active = true;
      state.changedAt = opts.tMs;
      return { state, start: true, end: false };
    }
  } else {
    state.candidateSince = -1;
  }
  return { state, start: false, end: false };
}
