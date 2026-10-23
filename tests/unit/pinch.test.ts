import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PINCH,
  PINCH_SENSITIVITY,
  initialPinch,
  isFist,
  pinchValue,
  updatePinch
} from '../../src/gestures/pinch';
import type { Vec3 } from '../../src/types';

function cloud(): Vec3[] {
  return Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
}

/**
 * Reference hand in metres: palm width 8.5 cm (index MCP → pinky MCP), wrist at the origin.
 * Coordinates are unit-agnostic, so the same cloud doubles as normalized landmarks.
 */
function hand(world: Vec3[]): Vec3[] {
  world[0] = { x: 0, y: 0, z: 0 };
  world[5] = { x: -0.042, y: 0.075, z: 0 };
  world[17] = { x: 0.043, y: 0.065, z: 0 };
  world[9] = { x: 0, y: 0.09, z: 0 };
  return world;
}

/** A real pinch: the marker centres never meet, the pads do. Tips are 2.2 cm apart. */
function touchingHand(): Vec3[] {
  const w = hand(cloud());
  w[4] = { x: -0.011, y: 0.112, z: 0 };
  w[8] = { x: 0.011, y: 0.11, z: 0 };
  return w;
}

describe('pinchValue', () => {
  it('is 1 when thumb and index tips touch', () => {
    const w = hand(cloud());
    w[4] = { x: 0, y: 0.08, z: 0 };
    w[8] = { x: 0, y: 0.08, z: 0 };
    expect(pinchValue(w, w)).toBeCloseTo(1, 6);
  });

  it('is near 0 for an open hand', () => {
    const w = hand(cloud());
    w[4] = { x: -0.09, y: 0.03, z: 0 };
    w[8] = { x: 0.09, y: 0.13, z: 0 };
    expect(pinchValue(w, w)).toBeLessThan(0.05);
    expect(pinchValue(w, w)).toBeGreaterThanOrEqual(0);
  });

  it('reads a realistic touching-but-offset pinch above the enter threshold', () => {
    const w = touchingHand();
    const value = pinchValue(w, w);
    expect(value).toBeGreaterThan(DEFAULT_PINCH.enter);
    expect(value).toBeLessThan(0.9);
  });

  it('ignores world-z noise when the image clearly shows a pinch', () => {
    const norm = touchingHand();
    const world = touchingHand();
    // MediaPipe's metric depth at arm's length can be off by several centimetres; the old
    // world-only metric divided this gap by wrist → MCP9 and landed below 0.8.
    world[4].z = -0.03;
    world[8].z = 0.045;
    const noisy = pinchValue(norm, world);
    expect(noisy).toBeGreaterThan(DEFAULT_PINCH.enter);
    expect(noisy).toBeCloseTo(pinchValue(norm, []), 6);
  });

  it('falls back to normalized landmarks when world data is missing', () => {
    const l = touchingHand();
    expect(pinchValue(l, [])).toBeGreaterThan(DEFAULT_PINCH.enter);
  });

  it('makes Light easier and Firm harder', () => {
    const w = touchingHand();
    const firm = pinchValue(w, w, PINCH_SENSITIVITY.firm);
    const normal = pinchValue(w, w, PINCH_SENSITIVITY.normal);
    const light = pinchValue(w, w, PINCH_SENSITIVITY.light);
    expect(firm).toBeLessThan(normal);
    expect(light).toBeGreaterThan(normal);
  });

  it('returns 0 instead of dividing by a degenerate palm', () => {
    const w = cloud();
    expect(pinchValue(w, w)).toBe(0);
  });
});

describe('isFist', () => {
  it('rejects a closed hand', () => {
    const l = cloud();
    l[0] = { x: 0, y: 0, z: 0 };
    for (const [tip, mcp] of [
      [8, 5],
      [12, 9],
      [16, 13],
      [20, 17]
    ] as const) {
      l[mcp] = { x: 0, y: 1, z: 0 };
      l[tip] = { x: 0, y: 0.4, z: 0 };
    }
    expect(isFist(l)).toBe(true);
  });

  it('accepts an open hand', () => {
    const l = cloud();
    for (const [tip, mcp] of [
      [8, 5],
      [12, 9],
      [16, 13],
      [20, 17]
    ] as const) {
      l[mcp] = { x: 0, y: 1, z: 0 };
      l[tip] = { x: 0, y: 2, z: 0 };
    }
    expect(isFist(l)).toBe(false);
  });
});

describe('updatePinch hysteresis', () => {
  const opts = (tMs: number, over: Partial<{ fist: boolean; valid: boolean }> = {}) => ({
    tMs,
    fist: false,
    valid: true,
    ...over
  });

  it('requires the minimum hold before firing', () => {
    let s = initialPinch();
    let out = updatePinch(s, 0.9, opts(1000));
    expect(out.start).toBe(false);
    s = out.state;
    out = updatePinch(s, 0.9, opts(1050));
    expect(out.start).toBe(false);
    s = out.state;
    out = updatePinch(s, 0.9, opts(1070));
    expect(out.start).toBe(true);
    expect(out.state.active).toBe(true);
  });

  it('stays active inside the hysteresis band and ends below exit', () => {
    let s = updatePinch(initialPinch(), 0.9, opts(0)).state;
    s = updatePinch(s, 0.9, opts(100)).state;
    expect(s.active).toBe(true);

    let out = updatePinch(s, 0.7, opts(300));
    expect(out.end).toBe(false);
    expect(out.state.active).toBe(true);

    out = updatePinch(out.state, DEFAULT_PINCH.exit - 0.01, opts(400));
    expect(out.end).toBe(true);
    expect(out.state.active).toBe(false);
  });

  it('fires just above the enter threshold', () => {
    let s = updatePinch(initialPinch(), DEFAULT_PINCH.enter + 0.01, opts(0)).state;
    const out = updatePinch(s, DEFAULT_PINCH.enter + 0.01, opts(DEFAULT_PINCH.minHoldMs + 1));
    s = out.state;
    expect(out.start).toBe(true);
    expect(s.active).toBe(true);
  });

  it('cancels a candidate that dips before the hold completes', () => {
    let s = updatePinch(initialPinch(), 0.9, opts(0)).state;
    s = updatePinch(s, 0.5, opts(30)).state;
    expect(s.candidateSince).toBe(-1);
    const out = updatePinch(s, 0.9, opts(60));
    expect(out.start).toBe(false);
  });

  it('never fires on a fist and ends an active pinch', () => {
    const fist = updatePinch(initialPinch(), 1, opts(0, { fist: true }));
    expect(fist.start).toBe(false);
    expect(fist.state.active).toBe(false);

    let s = updatePinch(initialPinch(), 0.95, opts(0)).state;
    s = updatePinch(s, 0.95, opts(100)).state;
    expect(s.active).toBe(true);
    const out = updatePinch(s, 0.95, opts(200, { fist: true }));
    expect(out.end).toBe(true);
    expect(out.state.active).toBe(false);
  });

  it('ends on invalid input', () => {
    let s = updatePinch(initialPinch(), 0.95, opts(0)).state;
    s = updatePinch(s, 0.95, opts(100)).state;
    const out = updatePinch(s, 0.95, opts(150, { valid: false }));
    expect(out.end).toBe(true);
    expect(out.state.candidateSince).toBe(-1);
  });
});
