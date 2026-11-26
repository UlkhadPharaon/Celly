import type { HandSide, Vec2 } from '../types';
import { clamp } from '../core/math';

/**
 * Display-only easing for the pinch cursor.
 *
 * Detections arrive at the camera/model rate (typically 20–30 Hz) while the screen refreshes at
 * 60–120 Hz. Drawing the newest detection verbatim makes the ring advance in visible steps: two
 * or three frames of motion happen in one frame, then it freezes until the next result. This
 * follower spreads each step over the following frames, which is what "smooth" looks like to the
 * eye, at the cost of a few milliseconds of trail.
 *
 * Selection is deliberately not routed through here: hover, the aim lock and the pinch target all
 * use the detection-time cursor, so a smoothed ring can never move the click target.
 */
export class CursorMotion {
  /** Time to close 63 % of the distance to the newest detection. */
  private static readonly TAU_MS = 26;
  /** A jump larger than this is a re-acquisition, not movement: snap instead of gliding. */
  private static readonly TELEPORT_PX = 260;
  /** After a gap this long the previous position is meaningless. */
  private static readonly STALE_MS = 350;

  private readonly states = new Map<HandSide, { x: number; y: number; at: number }>();

  /**
   * Advance one hand towards `target`. Call once per rendered frame with a monotonic `now`.
   * Returns the eased point; the first sample, a teleport and a stale restart snap exactly.
   */
  sample(side: HandSide, target: Vec2, now: number): Vec2 {
    const state = this.states.get(side);
    if (
      !state ||
      now - state.at > CursorMotion.STALE_MS ||
      !Number.isFinite(state.x) ||
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y) ||
      Math.hypot(target.x - state.x, target.y - state.y) > CursorMotion.TELEPORT_PX
    ) {
      this.states.set(side, { x: target.x, y: target.y, at: now });
      return { x: target.x, y: target.y };
    }

    // A paused tab or a long frame must not fling the cursor across the screen.
    const dt = clamp(now - state.at, 0, 64);
    const k = 1 - Math.exp(-dt / CursorMotion.TAU_MS);
    state.x += (target.x - state.x) * k;
    state.y += (target.y - state.y) * k;
    state.at = now;
    return { x: state.x, y: state.y };
  }

  /** The eased point without advancing time (for hit-tests that must match what is drawn). */
  peek(side: HandSide): Vec2 | null {
    const state = this.states.get(side);
    return state ? { x: state.x, y: state.y } : null;
  }

  reset(side?: HandSide): void {
    if (side) this.states.delete(side);
    else this.states.clear();
  }
}
