import type { GestureState, Intent } from '../types';

export const POINTER_DRAG_THRESHOLD_PX = 8;
export const TAP_MAX_DIST_PX = 10;
export const TAP_MAX_DURATION_MS = 500;
export const PINCH_DEADZONE = 0.02;
export const PINCH_SMOOTHING = 0.35;
export const WHEEL_BURST_MS = 120;

export function pointerStep(
  dx: number,
  dy: number,
  threshold = POINTER_DRAG_THRESHOLD_PX
): boolean {
  return Math.hypot(dx, dy) >= threshold;
}

export function pinchFactor(
  dist: number,
  baseDist: number,
  prevFactor = 1,
  deadzone = PINCH_DEADZONE,
  smoothing = PINCH_SMOOTHING
): { factor: number; delta: number } {
  const safeBase = Math.max(1, baseDist);
  const raw = Math.min(4, Math.max(0.25, dist / safeBase));
  if (Math.abs(raw - 1) < deadzone && prevFactor === 1) {
    return { factor: 1, delta: 1 };
  }
  const factor = Math.min(4, Math.max(0.25, prevFactor + (raw - prevFactor) * smoothing));
  const delta = prevFactor > 0 ? factor / prevFactor : 1;
  return { factor, delta };
}

export function classifyTap(
  distPx: number,
  durationMs: number,
  maxDist = TAP_MAX_DIST_PX,
  maxDuration = TAP_MAX_DURATION_MS
): boolean {
  return distPx <= maxDist && durationMs <= maxDuration;
}

export function wheelZoomDelta(deltaY: number): number {
  const clamped = Math.min(240, Math.max(-240, deltaY));
  return Math.exp(-clamped * 0.0018);
}

interface TrackedPointer {
  startX: number;
  startY: number;
  x: number;
  y: number;
  maxDist: number;
  startTime: number;
  pointerType: string;
}

export interface PointerControlsOptions {
  canvas: HTMLCanvasElement;
  isEnabled: () => boolean;
  onIntent: (intent: Intent) => void;
  onTap: (x: number, y: number) => void;
  onHover?: (x: number, y: number) => void;
  onHoverLeave?: () => void;
}

/**
 * Unifies mouse, touch, pen and wheel input over the WebGL canvas into the same
 * `Intent` stream produced by the hand-tracking pipeline.
 */
export class PointerControls {
  private readonly opts: PointerControlsOptions;
  private readonly pointers = new Map<number, TrackedPointer>();
  private gestureState: GestureState = 'IDLE';
  private pinchBaseDist = 1;
  private pinchFactorState = 1;
  private wheelFactor = 1;
  private wheelTimer: number | null = null;
  private attached = false;

  constructor(opts: PointerControlsOptions) {
    this.opts = opts;
  }

  get isEnabled(): boolean {
    return this.opts.isEnabled();
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    const { canvas } = this.opts;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerEnd);
    canvas.addEventListener('pointercancel', this.onPointerEnd);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    const { canvas } = this.opts;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerEnd);
    canvas.removeEventListener('pointercancel', this.onPointerEnd);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('wheel', this.onWheel);
    this.reset();
  }

  private reset(): void {
    this.pointers.clear();
    if (this.wheelTimer !== null) {
      window.clearTimeout(this.wheelTimer);
      this.wheelTimer = null;
    }
    this.wheelFactor = 1;
    this.pinchBaseDist = 1;
    this.pinchFactorState = 1;
    if (this.gestureState !== 'IDLE') {
      this.gestureState = 'IDLE';
      this.opts.onIntent({ type: 'state', state: 'IDLE', hint: '' });
    }
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.opts.isEnabled()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (this.wheelTimer !== null) {
      window.clearTimeout(this.wheelTimer);
      this.wheelTimer = null;
      this.wheelFactor = 1;
      if (this.gestureState === 'SCALING' && this.pointers.size === 0) {
        this.gestureState = 'IDLE';
        this.opts.onIntent({ type: 'state', state: 'IDLE', hint: '' });
      }
    }
    try {
      this.opts.canvas.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic PointerEvents in tests may not be active pointers.
    }
    this.pointers.set(event.pointerId, {
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      maxDist: 0,
      startTime: performance.now(),
      pointerType: event.pointerType
    });

    if (this.pointers.size === 2) {
      const [a, b] = Array.from(this.pointers.values());
      this.pinchBaseDist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      this.pinchFactorState = 1;
      if (this.gestureState === 'ROTATING') {
        this.gestureState = 'IDLE';
        this.opts.onIntent({ type: 'state', state: 'IDLE', hint: '' });
      }
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.opts.isEnabled()) {
      if (this.pointers.size > 0 || this.gestureState !== 'IDLE') this.reset();
      return;
    }

    const tracked = this.pointers.get(event.pointerId);
    if (!tracked) {
      if (event.pointerType !== 'touch') {
        this.opts.onHover?.(event.clientX, event.clientY);
      }
      return;
    }

    const dx = event.clientX - tracked.x;
    const dy = event.clientY - tracked.y;
    tracked.x = event.clientX;
    tracked.y = event.clientY;
    tracked.maxDist = Math.max(
      tracked.maxDist,
      Math.hypot(tracked.x - tracked.startX, tracked.y - tracked.startY)
    );

    if (this.pointers.size === 1) {
      if (this.gestureState !== 'ROTATING') {
        if (!pointerStep(tracked.x - tracked.startX, tracked.y - tracked.startY)) return;
        this.gestureState = 'ROTATING';
        this.opts.onIntent({ type: 'state', state: 'ROTATING', hint: '' });
      }
      const rect = this.opts.canvas.getBoundingClientRect();
      this.opts.onIntent({
        type: 'rotate',
        dx,
        dy,
        palm: { x: event.clientX - rect.left, y: event.clientY - rect.top }
      });
      return;
    }

    if (this.pointers.size >= 2) {
      const [a, b] = Array.from(this.pointers.values());
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const { factor, delta } = pinchFactor(dist, this.pinchBaseDist, this.pinchFactorState);
      this.pinchFactorState = factor;
      // Emit `scale` before the `SCALING` state transition so pages capture `scaleBase` once.
      this.opts.onIntent({ type: 'scale', factor, delta });
      if (this.gestureState !== 'SCALING') {
        this.gestureState = 'SCALING';
        this.opts.onIntent({ type: 'state', state: 'SCALING', hint: '' });
      }
    }
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    const tracked = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    try {
      this.opts.canvas.releasePointerCapture?.(event.pointerId);
    } catch {
      // Ignore synthetic events.
    }

    if (!tracked) return;

    if (
      event.type === 'pointerup' &&
      this.pointers.size === 0 &&
      this.gestureState === 'IDLE' &&
      classifyTap(tracked.maxDist, performance.now() - tracked.startTime) &&
      this.opts.isEnabled()
    ) {
      this.opts.onTap(event.clientX, event.clientY);
      return;
    }

    if (this.pointers.size === 0 && this.gestureState !== 'IDLE') {
      this.gestureState = 'IDLE';
      this.opts.onIntent({ type: 'state', state: 'IDLE', hint: '' });
      return;
    }

    if (this.pointers.size === 1 && this.gestureState === 'SCALING') {
      this.gestureState = 'IDLE';
      this.opts.onIntent({ type: 'state', state: 'IDLE', hint: '' });
      const remaining = Array.from(this.pointers.values())[0];
      if (remaining) {
        remaining.startX = remaining.x;
        remaining.startY = remaining.y;
        remaining.maxDist = 0;
      }
    }
  };

  private readonly onPointerLeave = (): void => {
    if (this.pointers.size === 0) {
      this.opts.onHoverLeave?.();
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.opts.isEnabled()) return;
    event.preventDefault();
    const step = wheelZoomDelta(event.deltaY);
    if (this.gestureState !== 'SCALING') {
      this.wheelFactor = 1;
    }
    this.wheelFactor = Math.min(4, Math.max(0.25, this.wheelFactor * step));
    this.opts.onIntent({ type: 'scale', factor: this.wheelFactor, delta: step });
    if (this.gestureState !== 'SCALING') {
      this.gestureState = 'SCALING';
      this.opts.onIntent({ type: 'state', state: 'SCALING', hint: '' });
    }
    if (this.wheelTimer !== null) {
      window.clearTimeout(this.wheelTimer);
    }
    this.wheelTimer = window.setTimeout(() => {
      this.wheelTimer = null;
      if (this.gestureState === 'SCALING' && this.pointers.size < 2) {
        this.gestureState = 'IDLE';
        this.wheelFactor = 1;
        this.opts.onIntent({ type: 'state', state: 'IDLE', hint: '' });
      }
    }, WHEEL_BURST_MS);
  };
}
