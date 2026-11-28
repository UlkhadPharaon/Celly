import { describe, expect, it } from 'vitest';
import {
  POINTER_DRAG_THRESHOLD_PX,
  TAP_MAX_DIST_PX,
  TAP_MAX_DURATION_MS,
  classifyTap,
  pinchFactor,
  pointerStep,
  wheelZoomDelta
} from '../../src/core/pointerControls';

describe('pointerControls pure helpers', () => {
  it('detects drag step only at or above the 8 px threshold', () => {
    expect(pointerStep(0, 0)).toBe(false);
    expect(pointerStep(5, 5)).toBe(false); // hypot ≈ 7.07
    expect(pointerStep(POINTER_DRAG_THRESHOLD_PX, 0)).toBe(true);
    expect(pointerStep(6, 6)).toBe(true); // hypot ≈ 8.49
  });

  it('applies a 2% deadzone at gesture start and smooths monotonically', () => {
    expect(pinchFactor(101, 100, 1)).toEqual({ factor: 1, delta: 1 });
    expect(pinchFactor(99, 100, 1)).toEqual({ factor: 1, delta: 1 });

    const step1 = pinchFactor(140, 100, 1);
    const step2 = pinchFactor(140, 100, step1.factor);
    expect(step1.factor).toBeGreaterThan(1);
    expect(step1.factor).toBeLessThan(1.4);
    expect(step2.factor).toBeGreaterThan(step1.factor);
    expect(step2.factor).toBeLessThan(1.4);
    expect(step1.delta).toBeCloseTo(step1.factor, 5);
  });

  it('clamps pinch factor within [0.25, 4]', () => {
    expect(pinchFactor(1000, 100, 4).factor).toBeLessThanOrEqual(4);
    expect(pinchFactor(1, 1000, 0.25).factor).toBeGreaterThanOrEqual(0.25);
  });

  it('classifies taps within distance and duration limits', () => {
    expect(classifyTap(0, 50)).toBe(true);
    expect(classifyTap(TAP_MAX_DIST_PX, TAP_MAX_DURATION_MS)).toBe(true);
    expect(classifyTap(TAP_MAX_DIST_PX + 1, 100)).toBe(false);
    expect(classifyTap(2, TAP_MAX_DURATION_MS + 1)).toBe(false);
  });

  it('maps wheel deltaY to multiplicative zoom steps', () => {
    expect(wheelZoomDelta(0)).toBe(1);
    expect(wheelZoomDelta(-100)).toBeGreaterThan(1);
    expect(wheelZoomDelta(100)).toBeLessThan(1);
    expect(wheelZoomDelta(-1000)).toBeCloseTo(wheelZoomDelta(-240), 6);
    expect(wheelZoomDelta(1000)).toBeCloseTo(wheelZoomDelta(240), 6);
  });
});
