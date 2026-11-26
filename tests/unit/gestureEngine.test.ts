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
    pinchPoint: over.pinchPoint ?? { ...cursor },
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
  it('selects a scene element immediately on pinch start', () => {
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
    expect(first.intents).toContainEqual({ type: 'select', id: 'nucleus', aim, pinchStart: true });
    expect(first.state).toBe('SELECTING');
    expect(first.cursors[0]).toMatchObject({ side: 'right', active: true, mode: 'pinch' });
    expect(first.cursors[0]).toMatchObject({ x: aim.x, y: aim.y });
    expect(e.getPinchLog().at(-1)).toMatchObject({ result: 'select', reason: 'pinch-start' });

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
    // Release must not fire a second selection.
    expect(types(out)).not.toContain('select');
  });

  it('does not select twice when the pinch is released', () => {
    const e = new GestureEngine();
    const first = e.step(
      ctx({
        t: 0,
        sceneHover: 'nucleus',
        hands: [hand({ side: 'right', pinching: true, pinchStart: true, pinchValue: 0.95 })]
      })
    );
    expect(types(first)).toContain('select');
    const out = e.step(
      ctx({
        t: 60,
        hands: [hand({ side: 'right', pinching: false, pinchEnd: true })]
      })
    );
    expect(types(out)).not.toContain('select');
    expect(types(out)).not.toContain('unselect');
  });

  it('unselects immediately on a pinch in empty space', () => {
    const e = new GestureEngine();
    const first = e.step(
      ctx({ t: 0, hands: [hand({ side: 'right', pinching: true, pinchStart: true })] })
    );
    expect(first.intents).toContainEqual({ type: 'unselect', aim: { x: 800, y: 500 } });
    expect(first.state).toBe('SELECTING');
    const out = e.step(
      ctx({ t: 160, hands: [hand({ side: 'right', pinching: false, pinchEnd: true })] })
    );
    expect(types(out)).not.toContain('unselect');
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

  it('clicks although the finger contact midpoint slides while the pinch closes', () => {
    // Real (and synthetic) hands bring the thumb to the index tip: the midpoint between them
    // travels ~30 px as the pinch closes. The travel budget measures the pointer, not that
    // midpoint, or every press would be spent before the user moved.
    const e = new GestureEngine();
    e.step(
      ctx({
        t: 0,
        uiHover: 'btn',
        hands: [
          hand({
            side: 'right',
            pinching: true,
            pinchStart: true,
            cursor: { x: 100, y: 100 },
            pinchPoint: { x: 100, y: 130 }
          })
        ]
      })
    );
    e.step(
      ctx({
        t: 120,
        uiHover: 'btn',
        hands: [
          hand({
            side: 'right',
            pinching: true,
            cursor: { x: 101, y: 100 },
            pinchPoint: { x: 100, y: 76 }
          })
        ]
      })
    );
    const out = e.step(
      ctx({
        t: 240,
        uiHover: 'btn',
        hands: [
          hand({
            side: 'right',
            pinching: false,
            pinchEnd: true,
            cursor: { x: 101, y: 100 },
            pinchPoint: { x: 100, y: 78 }
          })
        ]
      })
    );
    expect(out.intents).toContainEqual({ type: 'click', id: 'btn' });
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
        hands: [hand({ side: 'left', pinching: true, pinchStart: true, palm: { x: 0.4, y: 0.4 } })]
      })
    );
    expect(start.state).toBe('ROTATING');

    const move = e.step(
      ctx({
        t: 100,
        hands: [hand({ side: 'left', pinching: true, palm: { x: 0.42, y: 0.396 } })]
      })
    );
    // Palm coordinates are normalised, and the step is eased and capped: a raw delta of 0.02
    // becomes 0.02 * (1 - smooth) * gain, well under the per-frame cap.
    const eased = (1 - DEFAULT_GESTURE.rotateSmooth) * DEFAULT_GESTURE.rotateGain;
    const rotate = move.intents.find((i) => i.type === 'rotate');
    expect(rotate).toBeDefined();
    expect(rotate!.type === 'rotate' ? rotate!.dx : 0).toBeCloseTo(0.02 * eased, 6);
    expect(rotate!.type === 'rotate' ? rotate!.dy : 0).toBeCloseTo(-0.004 * eased, 6);

    const end = e.step(
      ctx({
        t: 200,
        hands: [hand({ side: 'left', pinching: false, pinchEnd: true, palm: { x: 0.42, y: 0.396 } })]
      })
    );
    expect(end.state).toBe('IDLE');
  });

  it('turns a realistic hand sweep into a usable angle', () => {
    // Guards the double-attenuation bug: the engine used to return radians that the lab then
    // multiplied by 0.0034, so a 20 cm sweep moved the cell about a tenth of a degree. A sweep
    // across a fifth of the screen must now produce a clearly visible turn.
    const e = new GestureEngine();
    e.step(
      ctx({
        t: 0,
        hands: [hand({ side: 'left', pinching: true, pinchStart: true, palm: { x: 0.4, y: 0.5 } })]
      })
    );

    let total = 0;
    for (let i = 1; i <= 10; i++) {
      const frame = e.step(
        ctx({
          t: i * 40,
          hands: [hand({ side: 'left', pinching: true, palm: { x: 0.4 + i * 0.02, y: 0.5 } })]
        })
      );
      for (const intent of frame.intents) {
        if (intent.type === 'rotate') total += intent.dx;
      }
    }
    // 0.2 normalised units of travel at gain 3.2 is about 0.64 rad (~37 degrees).
    expect(total).toBeGreaterThan(0.4);
    expect(total).toBeLessThan(1.0);
  });

  it('does not spin the cell from a trembling hand', () => {
    // The bug this pins: raw palm noise multiplied by the gain made a still hand rotate
    // frantically. A tremor below the deadzone must produce no rotation at all, and a single
    // large jump must be capped rather than applied whole.
    const e = new GestureEngine();
    e.step(
      ctx({
        t: 0,
        hands: [hand({ side: 'left', pinching: true, pinchStart: true, palm: { x: 0.5, y: 0.5 } })]
      })
    );

    const tremor = e.step(
      ctx({
        t: 50,
        hands: [hand({ side: 'left', pinching: true, palm: { x: 0.5005, y: 0.5004 } })]
      })
    );
    expect(tremor.intents.some((i) => i.type === 'rotate')).toBe(false);

    const jump = e.step(
      ctx({
        t: 100,
        hands: [hand({ side: 'left', pinching: true, palm: { x: 0.9, y: 0.5 } })]
      })
    );
    const rotate = jump.intents.find((i) => i.type === 'rotate');
    expect(rotate).toBeDefined();
    expect(Math.abs(rotate!.type === 'rotate' ? rotate!.dx : 0)).toBeLessThanOrEqual(
      DEFAULT_GESTURE.rotateMaxStep
    );
  });

  it('lets the left hand rotate while the right hand hovers', () => {
    const e = new GestureEngine();
    const start = e.step(
      ctx({
        t: 0,
        hands: [
          hand({ side: 'right', cursor: { x: 900, y: 500 } }),
          hand({ side: 'left', pinching: true, pinchStart: true, palm: { x: 0.3, y: 0.3 } })
        ]
      })
    );
    expect(start.state).toBe('ROTATING');
    const move = e.step(
      ctx({
        t: 100,
        hands: [
          hand({ side: 'right', cursor: { x: 900, y: 500 } }),
          hand({ side: 'left', pinching: true, palm: { x: 0.31, y: 0.3 } })
        ]
      })
    );
    const eased = (1 - DEFAULT_GESTURE.rotateSmooth) * DEFAULT_GESTURE.rotateGain;
    const rotate = move.intents.find((i) => i.type === 'rotate');
    expect(rotate).toBeDefined();
    expect(rotate!.type === 'rotate' ? rotate!.dx : 0).toBeCloseTo(0.01 * eased, 6);
    expect(rotate!.type === 'rotate' ? rotate!.dy : 0).toBeCloseTo(0, 6);
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

describe('GestureEngine — immediate selection guards', () => {
  it('reports the frozen pre-pinch aim on the select it commits', () => {
    const e = new GestureEngine();
    const aim = { x: 780, y: 490 };
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
            cursor: { x: 800, y: 500 },
            aim,
            aimLocked: true
          })
        ]
      })
    );
    expect(first.intents).toContainEqual({ type: 'select', id: 'nucleus', aim, pinchStart: true });
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
    expect(types(out)).not.toContain('select');
  });

  it('keeps a committed selection when the release cursor drifts', () => {
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
            cursor: { x: 800, y: 500 },
            aim,
            aimLocked: true
          })
        ]
      })
    );
    expect(first.intents).toContainEqual({ type: 'select', id: 'nucleus', aim, pinchStart: true });
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
    expect(types(out)).not.toContain('unselect');
    expect(e.getPinchLog().at(-1)).toMatchObject({ result: 'select', target: 'nucleus' });
  });

  it('never turns a lost hand into a click', () => {
    const e = new GestureEngine();
    e.step(
      ctx({
        t: 0,
        uiHover: 'btn',
        hands: [
          hand({ side: 'right', pinching: true, pinchStart: true, cursor: { x: 100, y: 100 } })
        ]
      })
    );
    const lost = e.step(
      ctx({
        t: 80,
        hands: [hand({ side: 'right', lost: true, pinching: false })]
      })
    );
    expect(types(lost)).not.toContain('click');
    expect(types(lost)).not.toContain('select');
    expect(types(lost)).not.toContain('unselect');
    const release = e.step(
      ctx({
        t: 180,
        hands: [hand({ side: 'right', pinching: false, pinchEnd: true })]
      })
    );
    expect(types(release)).not.toContain('click');
    expect(e.getPinchLog()).toHaveLength(0);
  });
});
