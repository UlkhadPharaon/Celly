import { describe, expect, it } from 'vitest';
import { REACH, mapNormalized, pinchContact, pointCursor, reach, unreach } from '../../src/gestures/cursor';
import type { Vec3 } from '../../src/types';

const VIEWPORT = { width: 1000, height: 800 };

function at(x: number, y: number): Vec3 {
  return { x, y, z: 0 };
}

describe('reach mapping', () => {
  it('maps the usable middle of the frame onto the full screen', () => {
    expect(reach(REACH.low)).toBe(0);
    expect(reach(REACH.high)).toBe(1);
    expect(reach(0.5)).toBeCloseTo(0.5, 6);
    expect(reach(0.2)).toBeGreaterThan(0.14);
    expect(reach(0.2)).toBeLessThan(0.16);
  });

  it('clamps the ignored outer 8 % to the screen edge', () => {
    expect(reach(0)).toBe(0);
    expect(reach(0.03)).toBe(0);
    expect(reach(0.97)).toBe(1);
    expect(reach(1)).toBe(1);
  });

  it('round-trips through unreach', () => {
    for (const v of [REACH.low, 0.2, 0.5, 0.83, REACH.high]) {
      expect(unreach(reach(v))).toBeCloseTo(v, 6);
    }
    expect(unreach(-1)).toBe(REACH.low);
    expect(unreach(2)).toBe(REACH.high);
  });

  it('applies the gain after mirroring', () => {
    const plain = mapNormalized(at(0.08, 0.92), { ...VIEWPORT, mirrorX: false, mirrorY: false });
    expect(plain.x).toBe(0);
    expect(plain.y).toBeCloseTo(VIEWPORT.height, 6);

    const mirrored = mapNormalized(at(0.08, 0.92), { ...VIEWPORT, mirrorX: true, mirrorY: false });
    expect(mirrored.x).toBeCloseTo(VIEWPORT.width, 6);
    expect(mirrored.y).toBeCloseTo(VIEWPORT.height, 6);
  });

  it('places a synthetic hand exactly on the requested screen point', () => {
    for (const mirrorX of [false, true]) {
      for (const x of [0, 137, 500, 863, 1000]) {
        const nx = unreach(x / VIEWPORT.width);
        const raw = mirrorX ? 1 - nx : nx;
        const screen = mapNormalized(at(raw, 0.5), { ...VIEWPORT, mirrorX, mirrorY: false });
        expect(screen.x).toBeCloseTo(x, 4);
      }
    }
  });
});

describe('pointer anchor', () => {
  const map = { ...VIEWPORT, mirrorX: false, mirrorY: false };

  function hand(): Vec3[] {
    // Wrist at the origin, thumb tip to the left, index tip straight up: the two are far apart,
    // exactly like an open hand.
    const points = Array.from({ length: 21 }, () => at(0, 0));
    points[4] = at(0.3, 0.5);
    points[8] = at(0.3, 0.2);
    return points;
  }

  it('puts the pointer on the index fingertip, not between thumb and index', () => {
    const landmarks = hand();
    const { cursor } = pointCursor(landmarks, map);
    const expected = mapNormalized(landmarks[8], map);
    expect(cursor.x).toBeCloseTo(expected.x, 6);
    expect(cursor.y).toBeCloseTo(expected.y, 6);

    const midpoint = mapNormalized(at(0.3, 0.35), map);
    expect(Math.hypot(cursor.x - midpoint.x, cursor.y - midpoint.y)).toBeGreaterThan(10);
  });

  it('keeps the pinch contact between the two fingertips for the travel budget', () => {
    const landmarks = hand();
    const contact = pinchContact(landmarks, map);
    const tip = mapNormalized(landmarks[8], map);
    const thumb = mapNormalized(landmarks[4], map);
    expect(contact.x).toBeCloseTo((tip.x + thumb.x) / 2, 6);
    expect(contact.y).toBeCloseTo((tip.y + thumb.y) / 2, 6);
  });
});
