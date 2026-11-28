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

/**
 * A hand is "lost" after this long without a detection. Long enough to bridge the re-detection
 * gap when MediaPipe drops a hand for a few frames (a natural pinch, motion blur, a hand near
 * the frame edge), short enough that a hand which really left does not leave a ghost behind.
 * Raised from 550 → 850 ms because:
 * 1. At 30 fps, 550 ms was ~16 frames — not enough when MediaPipe's re-detection after tracking
 *    loss routinely takes 20–30 frames (the detection model runs every N-th frame, N=5 by default).
 * 2. User-reported "flashing" was caused by repeated loss→re-detect→loss cycles that fell within
 *    the detection latency window.
 * 850 ms gives the detector a full re-detection cycle. Combined with the lower tracking confidence
 * threshold (0.25), a hand that is physically present is never visibly lost.
 */
const HAND_LOSS_MS = 850;

/**
 * Minimum consecutive unseen frames before we actually begin the loss countdown. This prevents
 * a single dropped frame from starting the HAND_LOSS_MS clock — only a sustained absence triggers
 * it. At 30 fps, 3 consecutive misses ≈ 100 ms, which filters out single-frame detector hiccups.
 */
const MIN_LOSS_FRAMES = 3;

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
 * across `CellyApp`: hand-side resolution, One-Euro filters, pinch hysteresis, the loss
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
  /**
   * Display-only smoothing. The filter is deliberately light (Cellab draws raw landmarks, so a
   * strong filter is felt as lag): it removes sub-pixel shimmer while the pointer and pinch use
   * the unfiltered landmarks below. `beta` is high for normalized units: the derivative is
   * measured in frame-widths per second (0.1 at rest, 1+ during a reach), so this is a ~90 ms
   * time constant at rest and ~20 ms in motion — jitter gone, deliberate movement not dragged.
   */
  private readonly normFilters = new LandmarkFilterBank(2.5, 5.5);
  private readonly worldFilters = new LandmarkFilterBank(2.5, 6);
  private readonly pinchStates = new Map<HandSide, PinchState>();
  private readonly lastFrames = new Map<HandSide, HandFrame>();
  private readonly lastSeen = new Map<HandSide, number>();
  private readonly missCounts = new Map<HandSide, number>();
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
   * not: with no detection it ages the loss tolerance out so cursors and hover retire.
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
      // `hand.score` is MediaPipe's *handedness* (Left/Right) confidence, not a presence signal.
      // Gating presence on it dropped a physically-present hand whenever the L/R classifier was
      // momentarily unsure — the skeleton blinked out and back several times a second. Presence is
      // already gated upstream by the detector's minHandDetection/Presence/Tracking confidences, so
      // here we only reject a non-finite score (which would poison the filters and the HUD).
      if (!Number.isFinite(hand.score)) return;
      if (!landmarksFinite(hand.landmarks)) return;
      const side = sides[i] ?? 'right';
      const rawNorm = hand.landmarks;
      const norm = this.normFilters.filter(`n:${side}`, rawNorm, dt);
      const hasWorld = hand.worldLandmarks.length === 21;
      // MediaPipe world is image-aligned. The skeleton is drawn in display space, so apply the
      // same mirror the pointer mapping applies, once, at the frame boundary.
      const mirrorWorld = (points: Vec3[]): Vec3[] =>
        points.map((p) => ({
          x: this.settings.mirrorX ? -p.x : p.x,
          y: this.settings.mirrorY ? -p.y : p.y,
          z: p.z
        }));
      const rawWorld = hasWorld ? mirrorWorld(hand.worldLandmarks) : [];
      const world = hasWorld
        ? mirrorWorld(this.worldFilters.filter(`w:${side}`, hand.worldLandmarks, dt))
        : norm.map((p) => ({ ...p }));

      // Pinch uses the *raw* landmarks. Cellab runs the same ratio on every MediaPipe result and
      // feels immediate; smoothing this signal only adds delay to the one gesture that must not
      // have any, and the hysteresis below already absorbs single-frame noise.
      const value = pinchValue(rawNorm, rawWorld, this.settings.pinchSensitivity);
      const previous = this.pinchStates.get(side) ?? initialPinch();
      // No fist gate and no frame-margin gate: a natural pinch brings the other fingers in and
      // often sits near the edge of frame. Both gates used to turn a held pinch into a release.
      const update = updatePinch(previous, value, { fist: false, valid: true, tMs: t }, DEFAULT_PINCH);
      this.pinchStates.set(side, update.state);

      // The pointer rides the (lightly filtered) index fingertip, so the dot always sits on the
      // finger the user aims with (and on the thumb/index contact while pinching).
      const { cursor, ndc } = pointCursor(norm, map);
      const rawCursor = pointCursor(rawNorm, map).cursor;
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
        pinchPoint: pinchContact(rawNorm, map),
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
      this.missCounts.set(side, 0);
      this.lostSent.delete(side);
      this.scores.set(side, hand.score);
    });

    // Hand-loss tolerance: persist the last pose between detections, but never mutate it
    // into a synthetic release. A hand is only declared lost once it has been unseen for the
    // whole time window AND for at least MIN_LOSS_FRAMES consecutive ticks — a single dropped
    // detection (detector hiccup, motion blur) must not start the countdown or retire the hand.
    for (const side of ['left', 'right'] as const) {
      if (frames.some((f) => f.side === side)) continue;
      const last = this.lastFrames.get(side);
      const seen = this.lastSeen.get(side) ?? -Infinity;
      const misses = (this.missCounts.get(side) ?? 0) + 1;
      this.missCounts.set(side, misses);
      const withinWindow = t - seen < HAND_LOSS_MS;
      const withinGrace = misses < MIN_LOSS_FRAMES;
      if (last && (withinWindow || withinGrace)) {
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
        this.missCounts.delete(side);
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

/** Reject a detection that would poison the filters (a NaN coordinate never recovers). */
function landmarksFinite(landmarks: Vec3[]): boolean {
  for (const p of landmarks) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return false;
  }
  return true;
}

function prettify(id: string): string {
  const text = id.replace(/[-_]/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
