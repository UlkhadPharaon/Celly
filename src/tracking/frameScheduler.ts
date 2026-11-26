/**
 * Camera-frame scheduler.
 *
 * The scheduler exists for one reason: camera acquisition must not be driven by the Three.js
 * render loop. `requestVideoFrameCallback` is the primary clock (one callback per presented
 * camera frame). A watchdog switches to a timer when rVFC is unavailable or stops firing (some
 * browsers suspend it for a video element that is not laid out). Timers are throttled in hidden
 * tabs, which is acceptable: tracking has nothing to show there.
 *
 * The scheduler only *asks* for a frame. It never captures or awaits anything, so a rejected
 * `createImageBitmap`, a busy worker or a rendering stall cannot stop the clock.
 */
export interface FrameSchedulerOptions {
  onFrame: () => void;
  /** rVFC registration for the capture video, or null when the browser lacks it. */
  requestFrame: ((callback: () => void) => number) | null;
  cancelFrame: ((handle: number) => void) | null;
  setTimer?: (callback: () => void, ms: number) => number;
  clearTimer?: (handle: number) => void;
  now?: () => number;
  /** Timer cadence when rVFC is unavailable. Two probes per camera frame is enough. */
  fallbackIntervalMs?: number;
  /** Switch to the timer when rVFC has not fired for this long. */
  watchdogAfterMs?: number;
}

export class FrameScheduler {
  private running = false;
  private usingVideoFrames: boolean;
  private frameHandle: number | null = null;
  private timerHandle: number | null = null;
  private watchdogHandle: number | null = null;
  private lastFrameAt = 0;

  private readonly setTimer: (callback: () => void, ms: number) => number;
  private readonly clearTimer: (handle: number) => void;
  private readonly now: () => number;
  private readonly fallbackIntervalMs: number;
  private readonly watchdogAfterMs: number;

  constructor(private readonly opts: FrameSchedulerOptions) {
    this.usingVideoFrames = !!opts.requestFrame && !!opts.cancelFrame;
    this.setTimer = opts.setTimer ?? ((callback, ms) => setTimeout(callback, ms) as unknown as number);
    this.clearTimer = opts.clearTimer ?? ((handle) => clearTimeout(handle));
    this.now = opts.now ?? (() => performance.now());
    this.fallbackIntervalMs = opts.fallbackIntervalMs ?? 16;
    this.watchdogAfterMs = opts.watchdogAfterMs ?? 1500;
  }

  get active(): boolean {
    return this.running;
  }

  get mode(): 'video-frame' | 'timer' | 'stopped' {
    if (!this.running) return 'stopped';
    return this.usingVideoFrames ? 'video-frame' : 'timer';
  }

  start(): void {
    this.stop();
    this.running = true;
    this.lastFrameAt = this.now();
    // Give requestVideoFrameCallback another chance after an explicit restart (the tracker
    // restarts the clock when it swaps the media source); the watchdog can still fall back.
    this.usingVideoFrames = !!this.opts.requestFrame && !!this.opts.cancelFrame;
    if (this.usingVideoFrames) {
      this.armVideoFrame();
      this.armWatchdog();
    } else {
      this.armTimer();
    }
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle !== null) {
      this.opts.cancelFrame?.(this.frameHandle);
      this.frameHandle = null;
    }
    if (this.timerHandle !== null) {
      this.clearTimer(this.timerHandle);
      this.timerHandle = null;
    }
    if (this.watchdogHandle !== null) {
      this.clearTimer(this.watchdogHandle);
      this.watchdogHandle = null;
    }
  }

  private armVideoFrame(): void {
    if (!this.running || !this.opts.requestFrame) return;
    // Re-arm before the callback body runs. If the body throws, the next frame is already queued.
    this.frameHandle = this.opts.requestFrame(() => {
      this.frameHandle = null;
      if (!this.running || !this.usingVideoFrames) return;
      this.lastFrameAt = this.now();
      this.armVideoFrame();
      this.opts.onFrame();
    });
  }

  private armTimer(): void {
    if (!this.running) return;
    this.timerHandle = this.setTimer(() => {
      this.timerHandle = null;
      if (!this.running) return;
      this.armTimer();
      this.opts.onFrame();
    }, this.fallbackIntervalMs);
  }

  private armWatchdog(): void {
    this.watchdogHandle = this.setTimer(() => {
      this.watchdogHandle = null;
      if (!this.running || !this.usingVideoFrames) return;
      if (this.now() - this.lastFrameAt < this.watchdogAfterMs) {
        this.armWatchdog();
        return;
      }
      // rVFC exists but does not fire (detached or suspended video). Keep the clock alive with
      // the timer path instead of leaving tracking silently dead.
      this.usingVideoFrames = false;
      if (this.frameHandle !== null) {
        this.opts.cancelFrame?.(this.frameHandle);
        this.frameHandle = null;
      }
      this.armTimer();
    }, this.watchdogAfterMs);
  }
}
