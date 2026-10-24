import type { QualityMode } from '../types';

export type DeviceClass = 'phone' | 'tablet' | 'desktop';

/**
 * Rendering budget for a class of device.
 *
 * Phones and tablets default to `low`, which caps DPR at 1, disables shadows and bloom and
 * renders a smaller dust field. `high` is still available from the quality switch, but it is
 * clamped to a resolution and feature set the panel can actually sustain.
 */
export interface DeviceProfile {
  deviceClass: DeviceClass;
  touch: boolean;
  coarsePointer: boolean;
  defaultQuality: QualityMode;
  highDpr: number;
  lowDpr: number;
  antialias: boolean;
  shadows: boolean;
  /** Bloom is allowed at high quality. Phones keep it off even then. */
  bloom: boolean;
  shadowSize: number;
  dustCount: number;
  floorSegments: number;
  ringSegments: number;
  cameraWidth: number;
  cameraHeight: number;
  cameraFps: number;
}

/**
 * Pure classification, so the breakpoints can be unit-tested without a DOM.
 *
 * `coarse` is the primary pointer. A Windows tablet with a trackpad plugged in reports a fine
 * pointer and is treated as a desktop, which is the right call for its GPU.
 */
export function deviceProfileFor(
  width: number,
  height: number,
  coarse: boolean,
  touch: boolean,
  dpr: number
): DeviceProfile {
  const shortest = Math.max(1, Math.min(width, height));
  const devClass: DeviceClass =
    coarse && shortest < 600
      ? 'phone'
      : coarse && shortest < 1100
        ? 'tablet'
        : !coarse && touch && shortest < 500
          ? 'phone'
          : 'desktop';

  const cap = Math.max(1, Math.min(3, Number.isFinite(dpr) ? dpr : 1));
  const highDpr =
    devClass === 'phone' ? Math.min(cap, 1.5) : devClass === 'tablet' ? Math.min(cap, 1.75) : Math.min(cap, 2);

  return {
    deviceClass: devClass,
    touch,
    coarsePointer: coarse,
    defaultQuality: devClass === 'desktop' ? 'high' : 'low',
    highDpr,
    lowDpr: 1,
    // MSAA is cheapest exactly where DPR is low. At 2x the extra samples rarely justify the
    // bandwidth, and mobile GPUs are bandwidth-bound.
    antialias: devClass === 'desktop' && cap <= 1.25,
    shadows: devClass === 'desktop',
    bloom: devClass !== 'phone',
    shadowSize: devClass === 'desktop' ? 2048 : 1024,
    dustCount: devClass === 'phone' ? 120 : devClass === 'tablet' ? 220 : 420,
    floorSegments: devClass === 'phone' ? 48 : devClass === 'tablet' ? 64 : 96,
    ringSegments: devClass === 'phone' ? 96 : devClass === 'tablet' ? 128 : 180,
    cameraWidth: devClass === 'phone' ? 640 : devClass === 'tablet' ? 960 : 1280,
    cameraHeight: devClass === 'phone' ? 480 : devClass === 'tablet' ? 540 : 720,
    cameraFps: devClass === 'phone' ? 24 : 30
  };
}

let cached: DeviceProfile | null = null;

/** Detects the current browser once. Safe to call during app construction. */
export function deviceProfile(): DeviceProfile {
  if (cached) return cached;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const touch = (navigator.maxTouchPoints ?? 0) > 0;
  cached = deviceProfileFor(window.innerWidth, window.innerHeight, coarse, touch, window.devicePixelRatio || 1);
  return cached;
}

/** Test hook: forget the cached profile after a viewport / emulation change. */
export function resetDeviceProfile(): void {
  cached = null;
}

export function preferredQuality(): QualityMode {
  return deviceProfile().defaultQuality;
}
