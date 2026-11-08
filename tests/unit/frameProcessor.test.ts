import { describe, expect, it, vi } from 'vitest';
import { FrameProcessor, type HoverRegistry } from '../../src/core/frameProcessor';
import type { HandFrame, RawHand, Settings, Vec3 } from '../../src/types';

/**
 * The per-frame hand pipeline (audit task 4.3). These tests pin the behaviour that moved out of
 * `CellyApp` unchanged: frame construction, the 250 ms hand-loss tolerance, aim locks, hover
 * resolution and gesture stepping. The module is DOM-free on purpose, so it runs in Node.
 */

const VIEWPORT = { width: 1000, height: 800 };

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    language: 'en',
    mirrorX: false,
    mirrorY: false,
    handsSwap: false,
    showWebcam: true,
    showFeedback: true,
    dwellClick: false,
    autoRotate: true,
    pinchSensitivity: 1,
    reducedMotion: false,
    highContrast: false,
    quality: 'auto',
    ...overrides
  } as Settings;
}

function point(x: number, y: number): Vec3 {
  return { x, y, z: 0 };
}

/** 21 landmarks with the index fingertip (8) at `tip`, everything else open and relaxed. */
function landmarks(tip: Vec3 = point(0.5, 0.5)): Vec3[] {
  const marks = Array.from({ length: 21 }, () => point(0.5, 0.5));
  marks[4] = point(0.36, 0.86);
  marks[5] = point(0.34, 0.72);
  marks[17] = point(0.66, 0.72);
  marks[8] = tip;
  return marks;
}

function rawHand(tip: Vec3 = point(0.5, 0.5)): RawHand {
  return { handedness: 'Right', score: 0.9, landmarks: landmarks(tip), worldLandmarks: [] };
}

function frame(side: 'left' | 'right', overrides: Partial<HandFrame> = {}): HandFrame {
  return {
    side,
    present: true,
    pinching: false,
    pinchValue: 0,
    pinchStart: false,
    pinchEnd: false,
    cursor: { x: 500, y: 400 },
    pinchPoint: { x: 500, y: 400 },
    rawCursor: { x: 500, y: 400 },
    aim: { x: 500, y: 400 },
    aimLocked: false,
    cursorNdc: { x: 0, y: 0 },
    palm: { x: 500, y: 400 },
    landmarks: landmarks(),
    world: [],
    handScale: 0.1,
    handSpan: 0.2,
    confidence: 1,
    pinchCandidateAt: -1,
    wrist: point(0.5, 0.5),
    roll: 0,
    tMs: 0,
    ...overrides
  };
}

class SpyRegistry implements HoverRegistry {
  hovered: string | null = null;
  hit: string | null = null;

  constructor(hit: string | null = null) {
    this.hit = hit;
  }

  hitTest(): string | null {
    return this.hit;
  }

  setHover(id: string | null): void {
    this.hovered = id;
  }
}

function processor(
  registry: HoverRegistry = new SpyRegistry(),
  pick: (x: number, y: number, options?: { radiusPx?: number }) => string | null = () => null
) {
  const page = {
    id: 'interactive' as const,
    pick,
    setHovered: (_id: string | null) => undefined,
    root: {} as HTMLElement
  };
  return new FrameProcessor(settings(), () => page as never, registry);
}

describe('FrameProcessor — frame building', () => {
  it('projects the index fingertip onto the requested screen point', () => {
    const fp = processor();
    fp.buildFrames({ hands: [rawHand(point(0.5, 0.5))], tMs: 0 }, 1 / 60, 0, VIEWPORT);

    expect(fp.frames).toHaveLength(1);
    const built = fp.frames[0];
    expect(built.present).toBe(true);
    expect(built.side).toBe('left'); // MediaPipe "Right" is the user's left hand (selfie flip).
    // 0.5 of the reachable band maps to the middle of the viewport.
    expect(built.cursor.x).toBeCloseTo(500, 1);
    expect(built.cursor.y).toBeCloseTo(400, 1);
    expect(built.tMs).toBe(0);
  });

  it('honours the mirror toggles', () => {
    const fp = new FrameProcessor(
      settings({ mirrorX: true }),
      () => null,
      new SpyRegistry()
    );
    fp.buildFrames({ hands: [rawHand(point(0.25, 0.5))], tMs: 0 }, 1 / 60, 0, VIEWPORT);
    expect(fp.frames[0].cursor.x).toBeGreaterThan(700);
  });

  it('skips hands that do not carry 21 landmarks', () => {
    const fp = processor();
    const broken = rawHand();
    broken.landmarks = broken.landmarks.slice(0, 9);
    const frames = fp.buildFrames({ hands: [broken], tMs: 0 }, 1 / 60, 0, VIEWPORT);
    expect(frames).toHaveLength(0);
  });
});

describe('FrameProcessor — hand-loss tolerance', () => {
  it('replays the last pose inside the window, emits one lost frame, then forgets the hand', () => {
    const fp = processor();
    const t = 10_000;
    fp.buildFrames({ hands: [rawHand()], tMs: 0 }, 1 / 60, t, VIEWPORT);
    expect(fp.frames).toHaveLength(1);

    // Still inside 250 ms: the same pose is replayed unchanged, never turned into a release.
    fp.buildFrames(null, 1 / 60, t + 100, VIEWPORT);
    expect(fp.frames).toHaveLength(1);
    expect(fp.frames[0].present).toBe(true);
    expect(fp.frames[0].pinchStart).toBe(false);
    expect(fp.frames[0].pinchEnd).toBe(false);

    // Past the window: exactly one present:false lost frame.
    fp.buildFrames(null, 1 / 60, t + 400, VIEWPORT);
    expect(fp.frames).toHaveLength(1);
    expect(fp.frames[0].present).toBe(false);
    expect(fp.frames[0].lost).toBe(true);

    // And it is emitted only once.
    fp.buildFrames(null, 1 / 60, t + 500, VIEWPORT);
    expect(fp.frames).toHaveLength(0);
  });

  it('keeps the hand alive while new detections keep arriving', () => {
    const fp = processor();
    const t = 10_000;
    for (let i = 0; i < 5; i += 1) {
      fp.buildFrames({ hands: [rawHand()], tMs: 0 }, 1 / 60, t + i * 90, VIEWPORT);
    }
    expect(fp.frames).toHaveLength(1);
    expect(fp.frames[0].present).toBe(true);
  });
});

describe('FrameProcessor — aim locks', () => {
  it('freezes the pre-pinch anchor while a pinch is in flight', () => {
    const fp = processor();
    // Build a little history so the anchor lookup has something to interpolate.
    for (let i = 0; i < 4; i += 1) {
      const t = 900 + i * 40;
      fp.trackAim('left', { x: t - 895, y: t - 895 }, t, {
        start: false,
        pinching: false,
        end: false
      });
    }
    const live = fp.trackAim('left', { x: 10, y: 10 }, 1060, {
      start: false,
      pinching: false,
      end: false
    });
    expect(live.aim).toEqual({ x: 10, y: 10 });
    expect(live.aimLocked).toBe(false);
    expect(live.lockAt).toBe(-1);

    fp.trackAim('left', { x: 999, y: 999 }, 1076, {
      start: true,
      pinching: true,
      end: false,
      anchorAt: 990
    });
    const held = fp.aimLocks.get('left');
    expect(held?.at).toBe(990);

    // The lock is sampled at the anchor time, so a moving fingertip cannot pull the target.
    const pinching = fp.trackAim('left', { x: 900, y: 700 }, 1092, {
      start: false,
      pinching: true,
      end: false
    });
    expect(pinching.aimLocked).toBe(true);
    expect(pinching.aim).toEqual(held?.point);
    expect(pinching.lockAt).toBe(990);
  });

  it('releases the lock once the pinch ends', () => {
    const fp = processor();
    const t = 500;
    fp.trackAim('right', { x: 100, y: 100 }, t, {
      start: true,
      pinching: true,
      end: false
    });
    expect(fp.aimLocks.has('right')).toBe(true);
    fp.clearFinishedAimLocks();
    expect(fp.aimLocks.has('right')).toBe(true);

    fp.setFrames([frame('right', { pinchEnd: true })]);
    fp.clearFinishedAimLocks();
    expect(fp.aimLocks.has('right')).toBe(false);
  });

  it('removes a dropped hand’s lock', () => {
    const fp = processor();
    fp.trackAim('right', { x: 1, y: 1 }, 0, {
      start: true,
      pinching: true,
      end: false
    });
    fp.clearAimLock('right');
    expect(fp.aimLocks.has('right')).toBe(false);
  });
});

describe('FrameProcessor — hover', () => {
  it('clears hover when no hand is present', () => {
    const registry = new SpyRegistry();
    const hovered: Array<string | null> = [];
    const page = {
      id: 'interactive' as const,
      pick: () => 'nucleus',
      setHovered: (id: string | null): void => {
        hovered.push(id);
      },
      root: {} as HTMLElement
    };
    const fp = new FrameProcessor(settings(), () => page as never, registry);
    fp.setFrames([]);
    fp.updateHover();

    expect(fp.uiHover).toBeNull();
    expect(fp.sceneHover).toBeNull();
    expect(fp.hoverLabel).toBe('');
    expect(registry.hovered).toBeNull();
    expect(hovered).toEqual([null]);
  });

  it('prefers a UI hit over the scene and keeps scene hover otherwise', () => {
    const registry = new SpyRegistry('control:dwell');
    const seen: Array<string | null> = [];
    const fp = new FrameProcessor(
      settings(),
      () =>
        ({
          id: 'interactive',
          pick: () => 'nucleus',
          setHovered: (id: string | null) => seen.push(id),
          root: {} as HTMLElement
        }) as never,
      registry
    );

    fp.setFrames([frame('right')]);
    fp.updateHover();
    expect(fp.uiHover).toBe('control:dwell');
    expect(fp.sceneHover).toBeNull();
    expect(seen).toEqual([null]);

    registry.hit = null;
    fp.setFrames([frame('right')]);
    fp.updateHover();
    expect(fp.uiHover).toBeNull();
    expect(fp.sceneHover).toBe('nucleus');
    expect(fp.hoverLabel).toBe('Nucleus');
    expect(registry.hovered).toBeNull();
    expect(seen).toEqual([null, 'nucleus']);
  });

  it('freezes the armed scene target for the rest of a pinch', () => {
    const picked: string[] = ['nucleus', 'ribosome'];
    let call = 0;
    const registry = new SpyRegistry();
    const fp = new FrameProcessor(
      settings(),
      () =>
        ({
          id: 'interactive',
          pick: () => picked[Math.min(call++, picked.length - 1)],
          setHovered: () => undefined,
          root: {} as HTMLElement
        }) as never,
      registry
    );

    fp.setFrames([frame('right', { pinchStart: true })]);
    fp.updateHover();
    expect(fp.sceneHover).toBe('nucleus');

    fp.setFrames([frame('right', { pinching: true })]);
    fp.updateHover();
    expect(fp.sceneHover).toBe('nucleus');
  });

  it('holds an armed target across small jitter (hysteresis)', () => {
    vi.useFakeTimers();
    try {
      const registry = new SpyRegistry();
      let call = 0;
      const fp = new FrameProcessor(
        settings(),
        () =>
          ({
            id: 'interactive',
            pick: () => (call++ === 0 ? 'nucleus' : null),
            setHovered: () => undefined,
            root: {} as HTMLElement
          }) as never,
        registry
      );

      const at = (cursor: { x: number; y: number }, tMs: number) =>
        frame('right', { cursor, aim: cursor, tMs });

      fp.setFrames([at({ x: 500, y: 400 }, 0)]);
      fp.updateHover();
      expect(fp.sceneHover).toBe('nucleus');
      const armed = fp.sceneHover;

      // 8 px of jitter 60 ms later must not drop the target into blank space.
      fp.setFrames([at({ x: 508, y: 404 }, 60)]);
      fp.updateHover();
      expect(fp.sceneHover).toBe(armed);

      // A deliberate move to empty space does clear it.
      fp.setFrames([at({ x: 700, y: 300 }, 120)]);
      fp.updateHover();
      expect(fp.sceneHover).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('FrameProcessor — gesture stepping', () => {
  it('steps the engine and reports its intents', () => {
    const fp = processor();
    const intents = fp.stepGestures(0);
    // With no hands the engine still opens with a hover + state intent (that is how the app
    // clears the cursor when the hands leave).
    expect(intents.map((intent) => intent.type)).toEqual(['hover', 'state']);
    expect(fp.gestureFrame?.state).toBe('IDLE');
  });

  it('enables swipes off the interactive lab only', () => {
    const registry = new SpyRegistry();
    const step = new FrameProcessor(settings(), () => ({ id: 'knowledge' }) as never, registry);
    step.stepGestures(0);
    expect(step.gestureFrame?.state).toBe('IDLE');

    const swapped = new FrameProcessor(
      settings({ dwellClick: true }),
      () => ({ id: 'interactive' }) as never,
      registry
    );
    swapped.stepGestures(0);
    expect(swapped.gestureFrame).not.toBeNull();
  });

  it('forgets hand-side calibration on reset', () => {
    const fp = processor();
    fp.buildFrames({ hands: [rawHand()], tMs: 0 }, 1 / 60, 0, VIEWPORT);
    expect(fp.frames[0].side).toBe('left');
    fp.resetHandSides();
    fp.buildFrames({ hands: [rawHand()], tMs: 16 }, 1 / 60, 16, VIEWPORT);
    expect(fp.frames[0].side).toBe('left');
  });
});
