import type {
  GestureFrame,
  HandFrame,
  HandSide,
  Intent,
  RawFrame,
  Settings,
  Vec2,
  Vec3
} from '../types';
import type { Page } from '../pages/page';
import { GestureEngine } from '../gestures/gestureEngine';
import { HandSideResolver } from '../tracking/handSide';
import { LandmarkFilterBank } from '../tracking/landmarkFilter';
import {
  DEFAULT_PINCH,
  initialPinch,
  isFist,
  pinchValue,
  updatePinch,
  type PinchState
} from '../gestures/pinch';
import {
  handRoll,
  mapNormalized,
  palmPoint,
  pinchContact,
  pointCursor
} from '../gestures/cursor';
import { AimTracker } from '../gestures/aim';
import { clamp, dist3 } from './math';

/** A hand is "lost" after this long without a detection (never mutated into a release). */
const HAND_LOSS_MS = 250;

export interface Viewport {
  width: number;
  height: number;
}

/** The subset of `ButtonRegistry` the hover pass needs (keeps this module DOM-free). */
export interface HoverRegistry {
  hitTest(x: number, y: number): string | null;
  setHover(id: string | null): void;
}

export interface AimLock {
  point: Vec2;
  source: string;
  at: number;
}

export interface TrackAimOptions {
  start: boolean;
  pinching: boolean;
  end: boolean;
  /** Timestamp the pre-pinch anchor is sampled at (defaults to `t`). */
  anchorAt?: number;
}

/**
 * The per-frame hand pipeline (audit task 4.3). It owns the state that used to be scattered
 * across `CellyApp`: hand-side resolution, One-Euro filters, pinch hysteresis, the 250 ms loss
 * tolerance, aim locks and sticky scene hover, plus the gesture engine.
 *
 * `CellyApp` keeps the frame clock, dispatch, rendering and test injection. Keeping this module
 * free of `document`/`window` access at import time (the viewport is passed in) lets the pipeline
 * be unit-tested in Node; the app passes live values on every call.
 */
export class FrameProcessor {
  readonly frames: HandFrame[] = [];
  readonly scores = new Map<HandSide, number>();
  readonly aim = new AimTracker();
  readonly aimLocks = new Map<HandSide, AimLock>();

  gestureFrame: GestureFrame | null = null;
  uiHover: string | null = null;
  sceneHover: string | null = null;
  hoverLabel = '';
  pickRadius = 52;

  private readonly engine = new GestureEngine();
  private readonly sideResolver = new HandSideResolver();
  private readonly normFilters = new LandmarkFilterBank();
  private readonly worldFilters = new LandmarkFilterBank();
  private readonly pinchStates = new Map<HandSide, PinchState>();
  private readonly lastFrames = new Map<HandSide, HandFrame>();
  private readonly lastSeen = new Map<HandSide, number>();
  private readonly lostSent = new Set<HandSide>();
  private sticky: { id: string; at: number; x: number; y: number } | null = null;

  constructor(
    private readonly settings: Settings,
    private readonly page: () => Page | null,
    private readonly registry: HoverRegistry
  ) {}

  /** Replace the frame list wholesale (synthetic replay ticks). */
  setFrames(frames: HandFrame[]): void {
    this.frames.length = 0;
    this.frames.push(...frames);
  }

  /**
   * Turn the newest detector result into gesture frames. Runs on every render tick, result or
   * not: with no detection it ages the 250 ms tolerance out so cursors and hover retire.
   */
  buildFrames(raw: RawFrame | null, dt: number, t: number, viewport: Viewport): HandFrame[] {
    const detections = (raw?.hands ?? []).map((hand) => ({
      label: hand.handedness,
      wrist: hand.landmarks[0] ?? { x: 0.5, y: 0.5, z: 0 },
      score: hand.score
    }));
    const sides = this.sideResolver.resolve(detections, { handsSwap: this.settings.handsSwap }, t);
    const map = {
      width: viewport.width,
      height: viewport.height,
      mirrorX: this.settings.mirrorX,
      mirrorY: this.settings.mirrorY
    };

    const frames: HandFrame[] = [];
    (raw?.hands ?? []).forEach((hand, i) => {
      if (hand.landmarks.length !== 21) return;
      const side = sides[i] ?? 'right';
      const norm = this.normFilters.filter(`n:${side}`, hand.landmarks, dt);
      const hasWorld = hand.worldLandmarks.length === 21;
      const world = hasWorld
        ? this.worldFilters
            .filter(`w:${side}`, hand.worldLandmarks, dt)
            // MediaPipe world is image-aligned. The skeleton is drawn in display space, so apply
            // the same mirror the pointer mapping applies, once, at the frame boundary.
            .map((p) => ({
              x: this.settings.mirrorX ? -p.x : p.x,
              y: this.settings.mirrorY ? -p.y : p.y,
              z: p.z
            }))
        : norm.map((p) => ({ ...p }));

      const valid = handVisible(norm) && hand.score > 0.35;
      const fist = isFist(norm);
      const value = pinchValue(norm, hasWorld ? world : [], this.settings.pinchSensitivity);
      const previous = this.pinchStates.get(side) ?? initialPinch();
      const update = updatePinch(previous, value, { fist, valid, tMs: t }, DEFAULT_PINCH);
      this.pinchStates.set(side, update.state);

      // The pointer rides the index fingertip, so the dot always sits on the finger the user
      // aims with (and on the thumb/index contact while pinching).
      const { cursor, ndc } = pointCursor(norm, map);
      const rawCursor = pointCursor(hand.landmarks, map).cursor;
      const wristScreen = mapNormalized(norm[0], map);
      const mcpScreen = mapNormalized(norm[9], map);
      const handSpan =
        Math.hypot(mcpScreen.x - wristScreen.x, mcpScreen.y - wristScreen.y) /
        Math.max(1, map.height);

      // The selection anchor is sampled before the fingertips converge. It is frozen while the
      // pinch is in flight so the cursor does not slide off the organelle between start/release.
      const candidateAt = update.state.candidateSince;
      const aimState = this.trackAim(side, cursor, t, {
        start: update.start,
        pinching: update.state.active,
        end: update.end,
        anchorAt: candidateAt >= 0 ? candidateAt : t
      });

      frames.push({
        side,
        present: true,
        pinching: update.state.active,
        pinchValue: value,
        pinchStart: update.start,
        pinchEnd: update.end,
        cursor,
        pinchPoint: pinchContact(norm, map),
        rawCursor,
        aim: { x: aimState.aim.x, y: aimState.aim.y },
        aimLocked: aimState.aimLocked,
        cursorNdc: ndc,
        palm: palmPoint(norm, map),
        landmarks: norm,
        world,
        worldMetric: hasWorld,
        handScale: Math.max(0.03, dist3(world[0], world[9])),
        handSpan,
        confidence: hand.score,
        pinchCandidateAt: candidateAt,
        wrist: norm[0],
        roll: handRoll(norm),
        tMs: t
      });
      // Commit the newest state as soon as it is detected. The same object is replayed on ticks
      // where the camera has not produced a new frame, so a pinch cannot be ended by a stale tick.
      this.lastFrames.set(side, frames[frames.length - 1]);
      this.lastSeen.set(side, t);
      this.lostSent.delete(side);
      this.scores.set(side, hand.score);
    });

    // 250 ms hand-loss tolerance: persist the last pose between detections, but never mutate it
    // into a synthetic release. Only after the window expires do we emit one explicit lost frame.
    for (const side of ['left', 'right'] as const) {
      if (frames.some((f) => f.side === side)) continue;
      const last = this.lastFrames.get(side);
      const seen = this.lastSeen.get(side) ?? -Infinity;
      if (last && t - seen < HAND_LOSS_MS) {
        frames.push({ ...last, pinchStart: false, pinchEnd: false });
      } else if (last && !this.lostSent.has(side)) {
        // A single present:false transition lets the gesture engine clear in-flight candidates
        // without treating the loss as a deliberate release. It is not repeated every tick.
        frames.push({
          ...last,
          present: false,
          pinching: false,
          pinchValue: 0,
          pinchStart: false,
          pinchEnd: false,
          lost: true,
          confidence: 0,
          pinchCandidateAt: -1,
          aimLocked: false,
          aim: { ...last.cursor },
          rawCursor: { ...last.rawCursor }
        });
        this.lostSent.add(side);
        this.lastFrames.delete(side);
        this.lastSeen.delete(side);
        this.scores.delete(side);
        this.pinchStates.set(side, initialPinch());
        this.aimLocks.delete(side);
      }
    }

    this.frames.length = 0;
    this.frames.push(...frames);
    return this.frames;
  }

  /**
   * Feed the aim tracker and resolve the selection anchor for one hand. Returns the live cursor
   * or the frozen pre-pinch anchor, plus whether it is locked. Shared by detection frames and by
   * both synthetic-injection paths so the three cannot drift apart.
   */
  trackAim(side: HandSide, cursor: Vec2, t: number, options: TrackAimOptions): {
    aim: Vec2;
    aimLocked: boolean;
    lockAt: number;
  } {
    this.aim.push(side, t, cursor);
    let lock = this.aimLocks.get(side);
    if (options.start) {
      const at = options.anchorAt ?? t;
      const anchor = this.aim.aimFor(side, at);
      lock = { point: anchor.point, source: anchor.source, at };
      this.aimLocks.set(side, lock);
    } else if (options.pinching && !lock) {
      lock = { point: { ...cursor }, source: 'live', at: t };
      this.aimLocks.set(side, lock);
    }
    const aimLocked = !!lock && (options.start || options.pinching || options.end);
    return {
      aim: aimLocked && lock ? lock.point : cursor,
      aimLocked,
      lockAt: lock?.at ?? -1
    };
  }

  clearAimLock(side: HandSide): void {
    this.aimLocks.delete(side);
  }

  /** Resolve DOM + scene hover from the primary hand. */
  updateHover(): void {
    const primary = primaryHand(this.frames);
    if (!primary) {
      this.uiHover = null;
      this.sceneHover = null;
      this.hoverLabel = '';
      this.sticky = null;
      this.page()?.setHovered(null);
      this.registry.setHover(null);
      return;
    }

    this.pickRadius = clamp(52 * (0.1 / Math.max(0.04, primary.handSpan)), 40, 62);
    const aim = primary.aim;
    this.uiHover = this.registry.hitTest(aim.x, aim.y);
    if (primary.pinching && !primary.pinchStart) {
      // Freeze the armed scene target for the rest of the pinch. It was picked on the start frame
      // and the gesture engine already committed it, so re-picking mid-gesture could silently
      // move the target to a neighbour after the user committed.
      this.registry.setHover(this.uiHover);
      return;
    }
    if (this.uiHover) {
      this.sticky = null;
      this.sceneHover = null;
    } else {
      const now = performance.now();
      const page = this.page();
      const picked = page?.pick(aim.x, aim.y, { radiusPx: this.pickRadius }) ?? null;
      if (picked) {
        // Hysteresis: once a target is armed, a few pixels of landmark jitter must not switch to
        // an overlapping neighbour. Deliberate movement (>20 px) still re-aims immediately.
        const hold =
          this.sticky &&
          this.sticky.id !== picked &&
          now - this.sticky.at <= 220 &&
          Math.hypot(aim.x - this.sticky.x, aim.y - this.sticky.y) <= 20;
        if (hold) {
          this.sceneHover = this.sticky!.id;
        } else {
          this.sceneHover = picked;
          this.sticky = { id: picked, at: now, x: aim.x, y: aim.y };
        }
      } else if (
        this.sticky &&
        now - this.sticky.at <= 220 &&
        Math.hypot(aim.x - this.sticky.x, aim.y - this.sticky.y) <= 96
      ) {
        // Sticky armed hover: a few pixels of landmark jitter immediately after aiming must not
        // turn a target into blank space.
        this.sceneHover = this.sticky.id;
      } else {
        this.sceneHover = null;
        this.sticky = null;
      }
    }
    this.hoverLabel = this.sceneHover ? prettify(this.sceneHover) : '';
    this.registry.setHover(this.uiHover);
    this.page()?.setHovered(this.sceneHover);
  }

  /** Run the gesture engine for this frame and return the intents to dispatch. */
  stepGestures(t: number): Intent[] {
    this.gestureFrame = this.engine.step({
      t,
      hands: this.frames,
      uiHover: this.uiHover,
      sceneHover: this.sceneHover,
      swipeEnabled: this.page()?.id !== 'interactive',
      rotateEnabled: true,
      scaleEnabled: true,
      dwellEnabled: this.settings.dwellClick
    });
    return this.gestureFrame.intents;
  }

  clearFinishedAimLocks(): void {
    for (const frame of this.frames) {
      if (frame.pinchEnd || frame.lost || (!frame.pinching && !frame.pinchStart)) {
        this.aimLocks.delete(frame.side);
      }
    }
  }

  /** Reset the interaction state that must not survive a page change. */
  resetInteraction(): void {
    this.uiHover = null;
    this.sceneHover = null;
    this.engine.reset();
  }

  /** Forget hand-side calibration after the swap toggle changes. */
  resetHandSides(): void {
    this.sideResolver.reset();
  }

  get pinchLog(): ReturnType<GestureEngine['getPinchLog']> {
    return this.engine.getPinchLog();
  }

  get handScores(): number[] {
    return [...this.scores.values()];
  }
}

function primaryHand(frames: HandFrame[]): HandFrame | null {
  return (
    frames.find((f) => f.present && f.side === 'right') ?? frames.find((f) => f.present) ?? null
  );
}

/** Every pinch landmark must sit inside the frame for a pinch to register. */
function handVisible(landmarks: Vec3[]): boolean {
  for (const index of [0, 4, 8, 9]) {
    const p = landmarks[index];
    if (!p) return false;
    if (p.x < 0.004 || p.x > 0.996 || p.y < 0.004 || p.y > 0.996) return false;
  }
  return true;
}

function prettify(id: string): string {
  const text = id.replace(/[-_]/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
