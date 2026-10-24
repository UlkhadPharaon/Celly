import { describe, expect, it } from 'vitest';
import { DEFAULT_GESTURE, GestureEngine } from '../../src/gestures/gestureEngine';
import type { GestureContext, GestureFrame, HandFrame, HandSide, Vec2, Vec3 } from '../../src/types';

const zero3: Vec3 = { x: 0, y: 0, z: 0 };

function hand(over: Partial<HandFrame> & { side: HandSide }): HandFrame {
  const cursor: Vec2 = over.cursor ?? { x: 800, y: 500 };
  return {
    present: true,
    pinching: false,
    pinchValue: 0,
    pinchStart: false,
    pinchEnd: false,
    cursor,
    rawCursor: over.rawCursor ?? { ...cursor },
    aim: over.aim ?? { ...cursor },
    aimLocked: false,
    cursorNdc: { x: 0, y: 0 },
    palm: over.palm ?? { ...cursor },
    landmarks: Array.from({ length: 21 }, () => ({ ...zero3 })),
    world: Array.from({ length: 21 }, () => ({ ...zero3 })),
    handScale: 0.09,
    handSpan: 0.1,
    confidence: 1,
    pinchCandidateAt: 0,
    wrist: { ...zero3 },
    roll: 0,
    tMs: 0,
    ...over
  };
}

function ctx(over: Partial<GestureContext> & { hands: HandFrame[]; t: number }): GestureContext {
  return {
    uiHover: null,
    sceneHover: null,
    swipeEnabled: false,
    rotateEnabled: true,
    scaleEnabled: true,
    dwellEnabled: false,
    ...over
  };
}

const types = (frame: GestureFrame): string[] => frame.intents.map((i) => i.type);

describe('GestureEngine — right hand', () => {
  it('arms a scene element on pinch and selects it on release after the hold', () => {
    const e = new GestureEngine();
    const aim = { x: 796, y: 486 };
    const first = e.step(
      ctx({
        t: 0,
        sceneHover: 'nucleus',
        hands: [
          hand({
            side: 'right',
            pinching: true,
            pinchStart: true,
            pinchValue: 0.95,
            aim,
            aimLocked: true
          })
        ]
      })
    );
    expect(first.intents).not.toContainEqual(expect.objectContaining({ type: 'select' }));
    expect(first.state).toBe('SELECTING');
    expect(first.cursors[0]).toMatchObject({ side: 'right', active: true, mode: 'pinch' });
    expect(first.cursors[0]).toMatchObject({ x: aim.x, y: aim.y });

    const out = e.step(
      ctx({
        t: 160,
        hands: [
          hand({
            side: 'right',
            pinching: false,
            pinchEnd: true,
            aim,
            aimLocked: true
          })
        ]
      })
    );
    expect(out.intents).toContainEqual({ type: 'select', id: 'nucleus', aim });
  });

  it('rejects a scene selection released too quickly', () => {
    const e = new GestureEngine();
    e.step(
      ctx({
        t: 0,
        sceneHover: 'nucleus',
        hands: [hand({ side: 'right', pinching: true, pinchStart: true, pinchValue: 0.95 })]
      })
    );
    const out = e.step(
      ctx({
        t: 60,
        hands: [hand({ side: 'right', pinching: false, pinchEnd: true })]
      })
    );
    expect(out.intents).not.toContainEqual(expect.objectContaining({ type: 'select' }));
    expect(e.getPinchLog().at(-1)).toMatchObject({ result: 'reject', reason: 'short-hold' });
  });

  it('unselects on a delayed pinch in empty space', () => {
    const e = new GestureEngine();
    const first = e.step(
      ctx({ t: 0, hands: [hand({ side: 'right', pinching: true, pinchStart: true })] })
    );
    expect(first.intents).not.toContainEqual({ type: 'unselect' });
    expect(first.state).toBe('SELECTING');
    const out = e.step(
      ctx({ t: 160, hands: [hand({ side: 'right', pinching: false, pinchEnd: true })] })
    );
    expect(out.intents).toContainEqual({ type: 'unselect', aim: { x: 800, y: 500 } });
  });

  it('clicks a UI button on release within the travel and time budget', () => {
    const e = new GestureEngine();
    const first = e.step(
      ctx({
        t: 0,
        uiHover: 'tab:knowledge',
        hands: [hand({ side: 'right', pinching: true, pinchStart: true, cursor: { x: 100, y: 100 } })]
      })
    );
    expect(first.state).toBe('HOVER_UI');
    expect(types(first)).not.toContain('select');

    const out = e.step(
      ctx({
        t: 220,
        uiHover: 'tab:knowledge',
        hands: [hand({ side: 'right', pinching: false, pinchEnd: true, cursor: { x: 106, y: 104 } })]
      })
    );
    expect(out.intents).toContainEqual({ type: 'click', id: 'tab:knowledge' });
  });

  it('rejects a click that travelled too far', () => {
    const e = new GestureEngine();
    e.step(
      ctx({
        t: 0,
        uiHover: 'btn',
        hands: [hand({ side: 'right', pinching: true, pinchStart: true, cursor: { x: 100, y: 100 } })]
      })
    );
    e.step(
      ctx({
        t: 100,
        hands: [hand({ side: 'right', pinching: true, cursor: { x: 140, y: 100 } })]
      })
    );
    const out = e.step(
      ctx({
        t: 200,
        hands: [hand({ side: 'right', pinching: false, pinchEnd: true, cursor: { x: 140, y: 100 } })]
      })
    );
    expect(types(out)).not.toContain('click');
  });

  it('rejects a click held longer than the budget', () => {
    const e = new GestureEngine();
    e.step(
      ctx({
        t: 0,
        uiHover: 'btn',
        hands: [hand({ side: 'right', pinching: true, pinchStart: true, cursor: { x: 100, y: 100 } })]
      })
    );
    const out = e.step(
      ctx({
        t: DEFAULT_GESTURE.clickMaxMs + 1,
        hands: [hand({ side: 'right', pinching: false, pinchEnd: true, cursor: { x: 100, y: 100 } })]
      })
    );
    expect(types(out)).not.toContain('click');
  });

  it('resolves a pinch-and-drag in empty space into a swipe', () => {
    const e = new GestureEngine();
    const first = e.step(
      ctx({
        t: 0,
        swipeEnabled: true,
        hands: [hand({ side: 'right', pinching: true, pinchStart: true, cursor: { x: 100, y: 500 } })]
      })
    );
    expect(first.intents).toContainEqual({ type: 'unselect', aim: { x: 100, y: 500 } });
    expect(first.state).toBe('SWIPING');

    const move = e.step(
      ctx({
        t: 100,
        swipeEnabled: true,
        hands: [hand({ side: 'right', pinching: true, cursor: { x: 300, y: 500 } })]
      })
    );
    expect(move.intents).toContainEqual({
      type: 'swipe',
      direction: 'right',
      progress: (200 / DEFAULT_GESTURE.swipeThresholdPx),
      phase: 'move'
    });

    const end = e.step(
      ctx({
        t: 200,
        hands: [hand({ side: 'right', pinching: false, pinchEnd: true, cursor: { x: 300, y: 500 } })]
      })
    );
    expect(end.intents).toContainEqual({
      type: 'swipe',
      direction: 'right',
      progress: (200 / DEFAULT_GESTURE.swipeThresholdPx),
      phase: 'end'
    });
  });

  it('does not swipe when the page disables swiping', () => {
    const e = new GestureEngine();
    e.step(ctx({ t: 0, hands: [hand({ side: 'right', pinching: true, pinchStart: true })] }));
    const move = e.step(
      ctx({ t: 100, hands: [hand({ side: 'right', pinching: true, cursor: { x: 1200, y: 500 } })] })
    );
    expect(types(move)).not.toContain('swipe');
  });

  it('clears every in-flight gesture when the primary hand disappears', () => {
    const e = new GestureEngine();
    e.step(
      ctx({
        t: 0,
        uiHover: 'btn',
        hands: [hand({ side: 'right', pinching: true, pinchStart: true, cursor: { x: 100, y: 100 } })]
      })
    );
    const out = e.step(ctx({ t: 100, hands: [] }));
    expect(out.state).toBe('IDLE');
    expect(types(out)).not.toContain('click');
    expect(out.cursors).toHaveLength(0);

    // A later pinch is a fresh gesture, not a release of the old one.
    const again = e.step(
      ctx({ t: 200, hands: [hand({ side: 'right', pinching: false, pinchEnd: true })] })
    );
    expect(types(again)).not.toContain('click');
  });

  it('fires a click after the dwell delay when dwell-to-click is enabled', () => {
    const e = new GestureEngine();
    const first = e.step(
      ctx({ t: 0, dwellEnabled: true, uiHover: 'btn', hands: [hand({ side: 'right' })] })
    );
    expect(first.dwellProgress).toBe(0);
    const out = e.step(
      ctx({
        t: DEFAULT_GESTURE.dwellMs + 10,
        dwellEnabled: true,
        uiHover: 'btn',
        hands: [hand({ side: 'right' })]
      })
    );
    expect(out.intents).toContainEqual({ type: 'click', id: 'btn' });
    expect(out.dwellProgress).toBe(1);
  });
});

describe('GestureEngine — left hand and both hands', () => {
  it('rotates from a left pinch and palm movement', () => {
    const e = new GestureEngine();
    const start = e.step(
      ctx({
        t: 0,
        hands: [hand({ side: 'left', pinching: true, pinchStart: true, palm: { x: 400, y: 400 } })]
      })
    );
    expect(start.state).toBe('ROTATING');

    const move = e.step(
      ctx({
        t: 100,
        hands: [hand({ side: 'left', pinching: true, palm: { x: 420, y: 396 } })]
      })
    );
    expect(move.intents).toContainEqual({
      type: 'rotate',
      dx: 20 * DEFAULT_GESTURE.rotateGain,
      dy: -4 * DEFAULT_GESTURE.rotateGain
    });

    const end = e.step(
      ctx({
        t: 200,
        hands: [hand({ side: 'left', pinching: false, pinchEnd: true, palm: { x: 420, y: 396 } })]
      })
    );
    expect(end.state).toBe('IDLE');
  });

  it('lets the left hand rotate while the right hand hovers', () => {
    const e = new GestureEngine();
    const start = e.step(
      ctx({
        t: 0,
        hands: [
          hand({ side: 'right', cursor: { x: 900, y: 500 } }),
          hand({ side: 'left', pinching: true, pinchStart: true, palm: { x: 300, y: 300 } })
        ]
      })
    );
    expect(start.state).toBe('ROTATING');
    const move = e.step(
      ctx({
        t: 100,
        hands: [
          hand({ side: 'right', cursor: { x: 900, y: 500 } }),
          hand({ side: 'left', pinching: true, palm: { x: 310, y: 300 } })
        ]
      })
    );
    expect(move.intents).toContainEqual({ type: 'rotate', dx: 70, dy: 0 });
  });

  it('scales with two pinches, then cools down before returning to idle', () => {
    const e = new GestureEngine();
    const start = e.step(
      ctx({
        t: 0,
        hands: [
          hand({ side: 'right', pinching: true, cursor: { x: 600, y: 500 } }),
          hand({ side: 'left', pinching: true, cursor: { x: 1000, y: 500 } })
        ]
      })
    );
    expect(start.state).toBe('SCALING');
    expect(types(start)).not.toContain('scale');

    const widen = e.step(
      ctx({
        t: 50,
        hands: [
          hand({ side: 'right', pinching: true, cursor: { x: 500, y: 500 } }),
          hand({ side: 'left', pinching: true, cursor: { x: 1100, y: 500 } })
        ]
      })
    );
    const scale = widen.intents.find((i) => i.type === 'scale');
    expect(scale).toBeDefined();
    if (scale?.type === 'scale') {
      expect(scale.factor).toBeCloseTo(1 + (1.5 - 1) * DEFAULT_GESTURE.scaleSmooth, 5);
      expect(scale.delta).toBeGreaterThan(1);
    }

    const release = e.step(
      ctx({
        t: 100,
        hands: [hand({ side: 'right', pinching: false, pinchEnd: true }), hand({ side: 'left' })]
      })
    );
    expect(release.state).toBe('COOLDOWN');
    expect(types(release)).not.toContain('select');

    const idle = e.step(ctx({ t: 100 + DEFAULT_GESTURE.twoHandCooldownMs, hands: [] }));
    expect(idle.state).toBe('IDLE');
  });

  it('lets a two-hand pinch override a rotate in progress', () => {
    const e = new GestureEngine();
    e.step(
      ctx({
        t: 0,
        hands: [
          hand({ side: 'right', cursor: { x: 900, y: 500 } }),
          hand({ side: 'left', pinching: true, pinchStart: true, palm: { x: 300, y: 300 } })
        ]
      })
    );
    const out = e.step(
      ctx({
        t: 50,
        sceneHover: 'nucleus',
        hands: [
          hand({ side: 'right', pinching: true, pinchStart: true, cursor: { x: 700, y: 500 } }),
          hand({ side: 'left', pinching: true, cursor: { x: 1100, y: 500 } })
        ]
      })
    );
    expect(out.state).toBe('SCALING');
    expect(types(out)).not.toContain('select');
  });
});

describe('GestureEngine — release selection guards', () => {
  it('reports the frozen pre-pinch aim even when the cursor drifts inside the budget', () => {
    const e = new GestureEngine();
    const aim = { x: 780, y: 490 };
    e.step(
      ctx({
        t: 0,
        sceneHover: 'nucleus',
        hands: [
          hand({
            side: 'right',
            pinching: true,
            pinchStart: true,
            pinchValue: 0.95,
            cursor: { x: 800, y: 500 },
            aim,
            aimLocked: true
          })
        ]
      })
    );
    const out = e.step(
      ctx({
        t: 180,
        hands: [
          hand({
            side: 'right',
            pinching: false,
            pinchEnd: true,
            cursor: { x: 812, y: 506 },
            aim,
            aimLocked: true
          })
        ]
      })
    );
    expect(out.intents).toContainEqual({ type: 'select', id: 'nucleus', aim });
  });

  it('rejects a release that travelled past the selection budget', () => {
    const e = new GestureEngine();
    e.step(
      ctx({
        t: 0,
        sceneHover: 'nucleus',
        hands: [
          hand({
            side: 'right',
            pinching: true,
            pinchStart: true,
            pinchValue: 0.95,
            cursor: { x: 800, y: 500 }
          })
        ]
      })
    );
    const out = e.step(
      ctx({
        t: 180,
        hands: [
          hand({
            side: 'right',
            pinching: false,
            pinchEnd: true,
            cursor: { x: 840, y: 500 }
          })
        ]
      })
    );
    expect(types(out)).not.toContain('select');
    expect(e.getPinchLog().at(-1)).toMatchObject({
      result: 'reject',
      reason: 'moved',
      target: 'nucleus'
    });
  });

  it('cancels an in-flight selection when the hand is lost, never turning loss into a click', () => {
    const e = new GestureEngine();
    e.step(
      ctx({
        t: 0,
        sceneHover: 'nucleus',
        hands: [
          hand({ side: 'right', pinching: true, pinchStart: true, pinchValue: 0.95 })
        ]
      })
    );
    const lost = e.step(
      ctx({
        t: 80,
        hands: [hand({ side: 'right', lost: true, pinching: false })]
      })
    );
    expect(types(lost)).not.toContain('select');
    expect(types(lost)).not.toContain('unselect');
    const release = e.step(
      ctx({
        t: 180,
        hands: [hand({ side: 'right', pinching: false, pinchEnd: true })]
      })
    );
    expect(types(release)).not.toContain('select');
    expect(e.getPinchLog()).toHaveLength(0);
  });
});
