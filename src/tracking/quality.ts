import type { TrackingQuality, Vec3 } from '../types';
import { clamp } from '../core/math';

export interface QualityInput {
  hands: number;
  scores: number[];
  /** Mean frame-to-frame landmark movement, normalized units. */
  jitter: number;
  trackerFps: number;
  /** Closest landmark distance to any frame edge, 0..0.5. */
  margin: number;
}

/** Distance from the nearest image edge across all landmarks, clipped to 0..0.5. */
export function frameMargin(landmarks: Vec3[][]): number {
  let m = 0.5;
  for (const hand of landmarks) {
    for (const p of hand) {
      m = Math.min(m, p.x, p.y, 1 - p.x, 1 - p.y);
    }
  }
  return clamp(m, 0, 0.5);
}

/**
 * Composite tracking quality (0..1). Weighted toward detection confidence and steadiness;
 * FPS and framing act as multipliers on usability rather than primary signals.
 */
export function scoreQuality(input: QualityInput): TrackingQuality {
  if (input.hands === 0) {
    return { level: 'none', value: 0, jitter: input.jitter, margin: input.margin };
  }
  const conf = input.scores.length
    ? input.scores.reduce((a, b) => a + b, 0) / input.scores.length
    : 0.5;
  // 0.004 is very still, 0.06 is shaky.
  const steadiness = 1 - clamp((input.jitter - 0.004) / 0.056, 0, 1);
  const fps = clamp((input.trackerFps - 14) / 16, 0, 1);
  const margin = clamp(input.margin / 0.18, 0, 1);

  const value = clamp(conf * 0.34 + steadiness * 0.3 + fps * 0.18 + margin * 0.18, 0, 1);
  const level = value >= 0.68 ? 'good' : value >= 0.42 ? 'medium' : 'poor';
  return { level, value, jitter: input.jitter, margin: input.margin };
}
