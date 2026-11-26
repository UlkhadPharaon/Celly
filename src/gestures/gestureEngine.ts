import type { GestureContext, GestureFrame, GestureState, HandFrame, HandSide, Intent, Vec2 } from '../types';
import { dist2 } from '../core/math';
import { GESTURE_HINTS } from './hints';

export interface GestureEngineConfig {
  twoHandCooldownMs: number;
  swipeThresholdPx: number;
  clickMaxMs: number;
  clickMaxTravelPx: number;
  dwellMs: number;
  rotateGain: number;
  scaleSmooth: number;
  /** Fraction of the previous palm delta kept each frame: 1 = no smoothing, 0 = frozen. */
  rotateSmooth: number;
  /** Palm movement below this (normalised units) is treated as jitter, not a rotation. */
  rotateDeadzone: number;
  /** Hard cap on the rotation applied in one frame, so a single bad frame cannot spin the cell. */
  rotateMaxStep: number;
  /** Change in hand separation below this (normalised units) is jitter, not a scale gesture. */
  scaleDeadzone: number;
}

export const DEFAULT_GESTURE: GestureEngineConfig = {
  twoHandCooldownMs: 150,
  swipeThresholdPx: 130,
  // A hand press is slower than a mouse click: people routinely hold a pinch for a second while
  // they decide. The travel budget, not the clock, is what separates a click from a drag.
  clickMaxMs: 1500,
  clickMaxTravelPx: 24,
  dwellMs: 900,
  // Palm tracking is noisy, so the raw delta is deadzoned, eased and capped. The gain is the
  // overall sensitivity, in radians per normalised unit of palm travel. The previous value was
  // further attenuated downstream, so the cell barely moved; with that removed, 3.2 gives a
  // deliberate 10 cm sweep roughly a third of a turn, and the light smoothing keeps it locked to
    // the hand instead of lagging behind it.
  rotateGain: 3.2,
  scaleSmooth: 0.35,
  rotateSmooth: 0.2,
  rotateDeadzone: 0.0012,
  rotateMaxStep: 0.22,
  scaleDeadzone: 0.004
};

interface ClickCandidate {
  id: string;
  t: number;
  x: number;
  y: number;
}

interface SwipeSession {
  startX: number;
  t: number;
}

export interface PinchEvent {
  t: number;
  side: HandSide;
  target: string | null;
  result: 'select' | 'unselect' | 'click' | 'reject';
  reason: string;
  heldMs: number;
  travelPx: number;
  aim: Vec2;
}

/**
 * Turns tracked hands into semantic intents. Knows nothing about pages or Three.js
 * (see DECISIONS D-18). One instance lives for the whole session.
 *
 * Scene selection commits on pinch start, like Cellab. UI buttons keep release semantics so a
 * hand can hover a button, close, then withdraw without firing it. The pre-pinch aim anchor is
 * frozen for the emitted select so landmark drift while the fingers close cannot move the target.
 */
export class GestureEngine {
  state: GestureState = 'IDLE';
  private cooldownUntil = 0;
  private clickCandidate: ClickCandidate | null = null;
  private swipe: SwipeSession | null = null;
  private scaleStartDist = 1;
  private scaleSmoothed = 1;
  /** Previous raw separation ratio, so a held-still pair of hands does not creep the scale. */
  private lastScaleRaw = 1;
  /** Smoothed palm delta, so a jittery detection cannot spin the cell. */
  private rotateDelta: Vec2 = { x: 0, y: 0 };
  private lastFactor = 1;
  private lastPalm: { x: number; y: number } | null = null;
  private lastHover: string | null = null;
  private lastHoverKind: 'ui' | 'scene' = 'ui';
  private dwellSince = 0;
  private dwellFired = false;
  private pinchLog: PinchEvent[] = [];

  constructor(private readonly cfg: GestureEngineConfig = DEFAULT_GESTURE) {}

  reset(): void {
    this.state = 'IDLE';
    this.cooldownUntil = 0;
    this.clickCandidate = null;
    this.swipe = null;
    this.lastPalm = null;
    this.rotateDelta = { x: 0, y: 0 };
    this.lastHover = null;
    this.dwellSince = 0;
    this.dwellFired = false;
    this.pinchLog = [];
  }

  /** Last 20 selection attempts, newest last. Shown in the debug overlay. */
  getPinchLog(): PinchEvent[] {
    return this.pinchLog.slice(-20);
  }

  step(ctx: GestureContext): GestureFrame {
    const intents: Intent[] = [];
    const right = ctx.hands.find((h) => h.present && h.side === 'right') ?? null;
    const left = ctx.hands.find((h) => h.present && h.side === 'left') ?? null;
    const primary: HandFrame | null = right ?? left;
    const primaryIsLeft = !right;
    const bothPinching = !!(right?.pinching && left?.pinching);

    // ---------------------------------------------------------------- scaling
    if (this.state === 'SCALING') {
      if (!bothPinching || !right || !left) {
        this.state = 'COOLDOWN';
        this.cooldownUntil = ctx.t + this.cfg.twoHandCooldownMs;
        this.lastPalm = null;
        this.rotateDelta = { x: 0, y: 0 };
      } else {
        const d = Math.max(1, dist2(right.cursor, left.cursor));
        // The factor is measured against the distance at the moment both pinches landed, so
        // spreading the hands scales up and bringing them together scales down. A deadzone stops
        // the cell creeping while the hands are held still, which is what made the scale appear
        // to move on its own the instant both pinches registered.
        const raw = d / this.scaleStartDist;
        const moved = Math.abs(raw - this.lastScaleRaw);
        this.lastScaleRaw = raw;
        if (moved >= this.cfg.scaleDeadzone) {
          this.scaleSmoothed += (raw - this.scaleSmoothed) * this.cfg.scaleSmooth;
        }
        const delta = this.lastFactor > 0 ? this.scaleSmoothed / this.lastFactor : 1;
        this.lastFactor = this.scaleSmoothed;
        if (Math.abs(delta - 1) > 1e-4) {
          intents.push({ type: 'scale', factor: this.scaleSmoothed, delta });
        }
      }
    } else if (bothPinching && right && left && ctx.scaleEnabled) {
      // Two pinches always mean scale. A click candidate left over from the right hand's pinch
      // (it landed on a button a frame earlier) used to veto this branch, which is why the scale
      // gesture often refused to start; the candidate is simply dropped instead.
      this.scaleStartDist = Math.max(1, dist2(right.cursor, left.cursor));
      this.scaleSmoothed = 1;
      this.lastScaleRaw = 1;
      this.lastFactor = 1;
      this.state = 'SCALING';
      this.lastPalm = null;
      this.rotateDelta = { x: 0, y: 0 };
      this.swipe = null;
      this.clickCandidate = null;
    }

    if (this.state !== 'SCALING' && !primary) {
      // The hand left the frame (past the tracker's tolerance window): drop any in-flight
      // gesture without firing a click, so nothing stays stuck in SELECTING/ROTATING.
      this.clickCandidate = null;
      this.swipe = null;
      this.lastPalm = null;
      if (this.state !== 'COOLDOWN') this.state = 'IDLE';
    }

    if (this.state !== 'SCALING' && primary) {
      if (primary.lost) {
        // A frame held during the tracker's loss window is not a deliberate release. Never turn
        // a dropped hand into a selection or an unselection.
        this.clickCandidate = null;
        this.swipe = null;
      } else {
        // ---------------------------------------------------------- primary pinch
        if (primary.pinchStart) {
          // Scene targets commit on the first active pinch frame. UI buttons keep their
          // release semantics because a click candidate still needs the full press.
          const aim = { x: primary.aim.x, y: primary.aim.y };
          if (ctx.uiHover) {
            // The press point is the pointer, not the thumb/index contact midpoint: the midpoint
            // slides towards the thumb as the fingers close, which would spend the click's travel
            // budget before the user moved at all.
            this.clickCandidate = {
              id: ctx.uiHover,
              t: ctx.t,
              x: primary.cursor.x,
              y: primary.cursor.y
            };
            this.swipe = null;
          } else if (ctx.sceneHover) {
            intents.push({ type: 'select', id: ctx.sceneHover, aim, pinchStart: true });
            this.logPinch({
              t: ctx.t,
              side: primary.side,
              target: ctx.sceneHover,
              result: 'select',
              reason: 'pinch-start',
              heldMs: 0,
              travelPx: 0,
              aim
            });
            this.swipe = null;
          } else if (primaryIsLeft && ctx.rotateEnabled) {
            // Left-only use starts a rotate immediately; blank space also releases any selection.
            intents.push({ type: 'unselect', aim });
            this.beginRotate(primary);
          } else if (ctx.swipeEnabled) {
            // Pages that allow swiping treat a blank pinch as navigation, not a selection.
            intents.push({ type: 'unselect', aim });
            this.swipe = { startX: primary.pinchPoint.x, t: ctx.t };
          } else {
            // Pinching empty space releases the current selection immediately, matching the
            // on-screen "pinch empty space to release" instruction.
            intents.push({ type: 'unselect', aim });
            this.logPinch({
              t: ctx.t,
              side: primary.side,
              target: null,
              result: 'unselect',
              reason: 'blank-start',
              heldMs: 0,
              travelPx: 0,
              aim
            });
          }
        }

        if (primary.pinching) {
          if (this.clickCandidate) {
            const moved = dist2(primary.cursor, this.clickCandidate);
            if (moved > this.cfg.clickMaxTravelPx) this.clickCandidate = null;
          }
          if (this.swipe) {
            const progress = (primary.pinchPoint.x - this.swipe.startX) / this.cfg.swipeThresholdPx;
            intents.push({
              type: 'swipe',
              direction: progress >= 0 ? 'right' : 'left',
              progress,
              phase: 'move'
            });
          }
        }

        if (primary.pinchEnd) {
          if (this.clickCandidate) {
            const held = ctx.t - this.clickCandidate.t;
            const moved = dist2(primary.cursor, this.clickCandidate);
            if (held <= this.cfg.clickMaxMs && moved <= this.cfg.clickMaxTravelPx) {
              intents.push({ type: 'click', id: this.clickCandidate.id });
              this.logPinch({
                t: ctx.t,
                side: primary.side,
                target: this.clickCandidate.id,
                result: 'click',
                reason: 'ui-release',
                heldMs: held,
                travelPx: moved,
                aim: { x: primary.aim.x, y: primary.aim.y }
              });
            } else {
              // A dropped press is a bug report on its own: the log names which budget failed.
              this.logPinch({
                t: ctx.t,
                side: primary.side,
                target: this.clickCandidate.id,
                result: 'reject',
                reason: held > this.cfg.clickMaxMs ? 'held-too-long' : 'moved-too-far',
                heldMs: held,
                travelPx: moved,
                aim: { x: primary.aim.x, y: primary.aim.y }
              });
            }
            this.clickCandidate = null;
          }

          if (this.swipe) {
            const progress = (primary.pinchPoint.x - this.swipe.startX) / this.cfg.swipeThresholdPx;
            intents.push({
              type: 'swipe',
              direction: progress >= 0 ? 'right' : 'left',
              progress,
              phase: 'end'
            });
            this.swipe = null;
          }
          if (this.lastPalm && primaryIsLeft) this.lastPalm = null;
        }
      }
    }

    // ------------------------------------------------------------- left rotate
    if (this.state !== 'SCALING' && !primaryIsLeft && left && !left.lost) {
      if (left.pinchStart && ctx.t >= this.cooldownUntil && ctx.rotateEnabled) {
        this.beginRotate(left);
      }
      if (left.pinching && this.state === 'ROTATING' && this.lastPalm) {
        // The palm position is emitted every frame while rotating. The consumer maps it
        // absolutely (anchor + delta), so no deadzone is needed here: a still hand produces a
        // still target, and a small tremor produces a proportionally small rotation.
        const step = this.rotateStep(left.palm);
        intents.push({
          type: 'rotate',
          dx: step.x,
          dy: step.y,
          palm: { x: left.palm.x, y: left.palm.y }
        });
      }
      if (left.pinchEnd && this.state === 'ROTATING') {
        this.lastPalm = null;
      }
    }

    // ------------------------------------------------------- rotate (left-only)
    if (primaryIsLeft && primary && !primary.lost) {
      if (primary.pinching && this.state === 'ROTATING' && this.lastPalm) {
        const step = this.rotateStep(primary.palm);
        intents.push({
          type: 'rotate',
          dx: step.x,
          dy: step.y,
          palm: { x: primary.palm.x, y: primary.palm.y }
        });
      }
      if (primary.pinchEnd) this.lastPalm = null;
    }

    // --------------------------------------------------------------- hover/dwell
    if (!primary?.pinching && !this.clickCandidate) {
      const hover = ctx.uiHover ?? ctx.sceneHover ?? null;
      const kind: 'ui' | 'scene' = ctx.uiHover ? 'ui' : 'scene';
      if (hover !== this.lastHover || kind !== this.lastHoverKind) {
        intents.push({ type: 'hover', id: hover, kind });
        this.lastHover = hover;
        this.lastHoverKind = kind;
        this.dwellSince = ctx.t;
        this.dwellFired = false;
      }
      if (ctx.dwellEnabled && ctx.uiHover) {
        if (ctx.t - this.dwellSince >= this.cfg.dwellMs && !this.dwellFired) {
          intents.push({ type: 'click', id: ctx.uiHover });
          this.dwellFired = true;
        }
      } else {
        this.dwellFired = false;
      }
    }

    // ------------------------------------------------------------------- state
    if (this.state === 'COOLDOWN' && ctx.t >= this.cooldownUntil) {
      this.state = 'IDLE';
    }
    if (this.state !== 'SCALING' && this.state !== 'COOLDOWN') {
      if (this.swipe) this.state = 'SWIPING';
      else if (this.clickCandidate) this.state = 'HOVER_UI';
      else if (this.lastPalm) this.state = 'ROTATING';
      else if (primary?.pinching) this.state = 'SELECTING';
      else if (ctx.uiHover) this.state = 'HOVER_UI';
      else this.state = 'IDLE';
    }

    intents.push({ type: 'state', state: this.state, hint: GESTURE_HINTS[this.state] });

    const dwellProgress =
      ctx.dwellEnabled && ctx.uiHover && !primary?.pinching
        ? Math.min(1, Math.max(0, (ctx.t - this.dwellSince) / this.cfg.dwellMs))
        : 0;

    // ----------------------------------------------------------------- cursors
    const cursors: GestureFrame['cursors'] = [];
    for (const h of ctx.hands) {
      if (!h.present) continue;
      const isPrimary = h === primary;
      cursors.push({
        side: h.side,
        x: h.aimLocked ? h.aim.x : h.cursor.x,
        y: h.aimLocked ? h.aim.y : h.cursor.y,
        visible: true,
        active: isPrimary,
        pinchValue: h.pinchValue,
        mode: h.pinching ? 'pinch' : isPrimary ? 'pointer' : 'passive'
      });
    }

    return { state: this.state, hint: GESTURE_HINTS[this.state], dwellProgress, intents, cursors };
  }

  private logPinch(event: PinchEvent): void {
    this.pinchLog.push(event);
    if (this.pinchLog.length > 20) this.pinchLog.shift();
  }

  private beginRotate(hand: HandFrame): void {
    this.state = 'ROTATING';
    this.lastPalm = { x: hand.palm.x, y: hand.palm.y };
    this.rotateDelta = { x: 0, y: 0 };
    this.clickCandidate = null;
    this.swipe = null;
  }

  /**
   * Palm delta → a smoothed, deadzoned, clamped rotation step.
   *
   * Raw palm tracking is noisy at the sub-pixel level, and the previous version multiplied that
   * noise by the gain with no filtering, which is why the cell spun on a still hand. Three guards
   * run in order: drop movement too small to be intentional, ease the rest over frames, then cap
   * the worst case so one dropped or wrong detection cannot whip the model around.
   */
  private rotateStep(current: { x: number; y: number }): Vec2 {
    const previous = this.lastPalm ?? current;
    let dx = current.x - previous.x;
    let dy = current.y - previous.y;
    this.lastPalm = { x: current.x, y: current.y };

    if (Math.abs(dx) < this.cfg.rotateDeadzone) dx = 0;
    if (Math.abs(dy) < this.cfg.rotateDeadzone) dy = 0;

    const smooth = this.cfg.rotateSmooth;
    this.rotateDelta = {
      x: this.rotateDelta.x * smooth + dx * (1 - smooth),
      y: this.rotateDelta.y * smooth + dy * (1 - smooth)
    };

    const cap = this.cfg.rotateMaxStep;
    return {
      x: Math.max(-cap, Math.min(cap, this.rotateDelta.x * this.cfg.rotateGain)),
      y: Math.max(-cap, Math.min(cap, this.rotateDelta.y * this.cfg.rotateGain))
    };
  }
}
