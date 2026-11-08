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
}

export const DEFAULT_GESTURE: GestureEngineConfig = {
  twoHandCooldownMs: 150,
  swipeThresholdPx: 130,
  clickMaxMs: 500,
  clickMaxTravelPx: 24,
  dwellMs: 900,
  rotateGain: 7,
  scaleSmooth: 0.35
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
      } else {
        const d = Math.max(1, dist2(right.cursor, left.cursor));
        const factor = d / this.scaleStartDist;
        this.scaleSmoothed += (factor - this.scaleSmoothed) * this.cfg.scaleSmooth;
        const delta = this.lastFactor > 0 ? this.scaleSmoothed / this.lastFactor : 1;
        this.lastFactor = this.scaleSmoothed;
        intents.push({ type: 'scale', factor: this.scaleSmoothed, delta });
      }
    } else if (bothPinching && right && left && ctx.scaleEnabled && !this.clickCandidate) {
      this.scaleStartDist = Math.max(1, dist2(right.cursor, left.cursor));
      this.scaleSmoothed = 1;
      this.lastFactor = 1;
      this.state = 'SCALING';
      this.lastPalm = null;
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
            this.clickCandidate = {
              id: ctx.uiHover,
              t: ctx.t,
              x: primary.pinchPoint.x,
              y: primary.pinchPoint.y
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
            const moved = dist2(primary.pinchPoint, this.clickCandidate);
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
            const moved = dist2(primary.pinchPoint, this.clickCandidate);
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
        const dx = (left.palm.x - this.lastPalm.x) * this.cfg.rotateGain;
        const dy = (left.palm.y - this.lastPalm.y) * this.cfg.rotateGain;
        if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) intents.push({ type: 'rotate', dx, dy });
        this.lastPalm = { x: left.palm.x, y: left.palm.y };
      }
      if (left.pinchEnd && this.state === 'ROTATING') {
        this.lastPalm = null;
      }
    }

    // ------------------------------------------------------- rotate (left-only)
    if (primaryIsLeft && primary && !primary.lost) {
      if (primary.pinching && this.state === 'ROTATING' && this.lastPalm) {
        const dx = (primary.palm.x - this.lastPalm.x) * this.cfg.rotateGain;
        const dy = (primary.palm.y - this.lastPalm.y) * this.cfg.rotateGain;
        if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) intents.push({ type: 'rotate', dx, dy });
        this.lastPalm = { x: primary.palm.x, y: primary.palm.y };
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
    this.clickCandidate = null;
    this.swipe = null;
  }
}
