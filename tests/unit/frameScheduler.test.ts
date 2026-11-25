import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrameScheduler } from '../../src/tracking/frameScheduler';

/**
 * The camera clock must keep asking for frames even when the render loop or the video pipeline
 * stalls. These tests pin the two clocks and the watchdog switch between them.
 */

afterEach(() => {
  vi.useRealTimers();
});

function videoClockHarness() {
  vi.useFakeTimers();
  let now = 0;
  const frames: number[] = [];
  let pending: (() => void) | null = null;
  const scheduler = new FrameScheduler({
    onFrame: () => frames.push(now),
    requestFrame: (callback) => {
      pending = callback;
      return 1;
    },
    cancelFrame: () => {
      pending = null;
    },
    now: () => now,
    watchdogAfterMs: 1000
  });
  const presentFrame = (advanceMs = 16): void => {
    now += advanceMs;
    const callback = pending;
    pending = null;
    callback?.();
  };
  /** Move the injected clock and the timer queue together (the watchdog compares both). */
  const advance = (ms: number): void => {
    now += ms;
    vi.advanceTimersByTime(ms);
  };
  return { scheduler, frames, presentFrame, advance, get pending() { return pending; } };
}

describe('FrameScheduler — video frames', () => {
  it('fires once per presented camera frame and re-arms before the callback', () => {
    const h = videoClockHarness();
    h.scheduler.start();
    expect(h.scheduler.mode).toBe('video-frame');
    expect(h.pending).not.toBeNull();

    h.presentFrame(16);
    expect(h.frames).toEqual([16]);
    // Re-armed: the next presented frame is still observed.
    expect(h.pending).not.toBeNull();
    h.presentFrame(16);
    expect(h.frames).toEqual([16, 32]);
  });

  it('falls back to the timer when rVFC stops firing', () => {
    const h = videoClockHarness();
    h.scheduler.start();

    // One real frame, then silence: the watchdog must switch clocks instead of leaving tracking
    // dead behind a callback the browser never calls.
    h.presentFrame(16);
    h.advance(1000);
    expect(h.scheduler.mode).toBe('timer');

    const before = h.frames.length;
    vi.advanceTimersByTime(16);
    expect(h.frames.length).toBe(before + 1);
  });

  it('stop() cancels the pending video callback and the watchdog', () => {
    const h = videoClockHarness();
    h.scheduler.start();
    h.scheduler.stop();

    expect(h.scheduler.mode).toBe('stopped');
    expect(h.pending).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(h.frames).toHaveLength(0);
  });
});

describe('FrameScheduler — timer fallback', () => {
  it('keeps a steady clock when requestVideoFrameCallback is unavailable', () => {
    vi.useFakeTimers();
    const frames: number[] = [];
    const scheduler = new FrameScheduler({
      onFrame: () => frames.push(performance.now()),
      requestFrame: null,
      cancelFrame: null,
      fallbackIntervalMs: 20
    });

    scheduler.start();
    expect(scheduler.mode).toBe('timer');
    vi.advanceTimersByTime(100);
    expect(frames.length).toBe(5);
    scheduler.stop();
    vi.advanceTimersByTime(100);
    expect(frames.length).toBe(5);
  });

  it('restarting re-tries the video clock after a profile change', () => {
    const h = videoClockHarness();
    h.scheduler.start();
    // Drive it into the timer path.
    h.advance(1000);
    expect(h.scheduler.mode).toBe('timer');

    h.scheduler.start();
    expect(h.scheduler.mode).toBe('video-frame');
  });
});
