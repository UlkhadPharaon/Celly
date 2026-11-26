import type { CameraStatus, RawFrame, TrackingStatus } from '../types';
import { deviceProfile, type DeviceProfile } from '../core/device';
import { FrameScheduler } from './frameScheduler';
import type { WorkerAssetSource, TrackingWorkerRequest, TrackingWorkerResponse } from './trackingProtocol';

export interface TrackerCallbacks {
  onCamera?: (status: CameraStatus, detail?: string) => void;
  onTracking?: (status: TrackingStatus, detail?: string) => void;
}

export function resolveAssetPath(relative: string): string {
  const base = new URL('.', document.baseURI);
  return new URL(relative, base).href;
}

/** Pinned CDN fallback, used only when the local wasm folder cannot be loaded. */
const CDN_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';
/**
 * The model is always the local copy: it is the larger download and must be available offline
 * even when the wasm runtime had to come from the CDN.
 */
const MODEL = resolveAssetPath('models/hand_landmarker.task');
/** Hand-model init inside the worker: 20 MB of wasm + model, local disk, but allow for cold cache. */
const WORKER_INIT_TIMEOUT_MS = 45_000;
/** Completed detections kept for the render loop. Bounded: a stalled frame must not build a queue. */
const MAX_RESULTS = 4;

/** `?tracker=cpu` / `?tracker=gpu` pin the delegate for the controlled A/B runs. */
function delegateOverride(search = window.location.search): Array<'GPU' | 'CPU'> | undefined {
  const value = (new URLSearchParams(search).get('tracker') ?? '').toLowerCase();
  if (value !== 'cpu' && value !== 'gpu') return undefined;
  return [value.toUpperCase() as 'CPU' | 'GPU'];
}

/**
 * Webcam + MediaPipe HandLandmarker, with inference off the main thread.
 *
 * Camera frames are converted to an `ImageBitmap` on the main thread and transferred to a
 * dedicated worker that owns the landmarker. At most one frame is in flight at a time — exactly
 * the single-flight + backpressure loop Cellab uses — so a slow inference never queues up and
 * never blocks rendering, gestures or DOM updates.
 *
 * Frame acquisition has its own clock (`FrameScheduler`): `requestVideoFrameCallback` fires once
 * per presented camera frame, so capture keeps running even when the Three.js render loop is
 * slow, throttled or stalled. Newest results are handed to the render loop through `drain()`.
 */
export class HandTracker {
  camera: CameraStatus = 'idle';
  tracking: TrackingStatus = 'idle';
  detail: string | null = null;
  trackerFps = 0;
  /** Duration of the last worker inference. A health signal only: it never blocks the main thread. */
  inferenceMs = 0;
  /** Camera frames submitted for inference, per second. */
  captureFps = 0;
  /** Requests to the camera pipeline that produced a bitmap, lifetime count. */
  captures = 0;

  video: HTMLVideoElement | null = null;
  /** How many times the stream was re-opened with new constraints (device-profile changes). */
  cameraReopens = 0;
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private workerReady = false;
  /** Completed detections, oldest first. Drained by the render loop. */
  private results: RawFrame[] = [];
  /** A `createImageBitmap` capture is in flight; drop camera frames until it resolves. */
  private capturing = false;
  /** A bitmap has been transferred and the worker owes us a result for it. */
  private inFlight = false;
  private frameId = 0;
  private lastVideoTime = -1;
  private frames = 0;
  private fpsClock = 0;
  private captureClock = 0;
  private captureWindowStart = 0;
  private lastResultAt = 0;
  private scheduler: FrameScheduler | null = null;
  private delegates: Array<'GPU' | 'CPU'> | undefined;
  private starting: Promise<void> | null = null;
  private startingFlag = false;
  private attempt = 0;
  private requestTimer: number | null = null;
  private initTimer: number | null = null;

  constructor(private readonly cb: TrackerCallbacks = {}) {}

  get ready(): boolean {
    return this.workerReady && this.camera === 'live';
  }

  /** The live stream, so each UI preview can own its own `<video>` sink. */
  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  /** How frame acquisition is currently driven (`requestVideoFrameCallback` or the timer). */
  get captureMode(): 'video-frame' | 'timer' | 'stopped' {
    return this.scheduler?.mode ?? 'stopped';
  }

  /** Results waiting for the render loop (never more than `MAX_RESULTS`). */
  get queued(): number {
    return this.results.length;
  }

  /** Milliseconds since the last detection result, or -1 before the first one. */
  get resultAgeMs(): number {
    return this.lastResultAt > 0 ? Math.max(0, performance.now() - this.lastResultAt) : -1;
  }

  /** True while a bitmap is being created or is inside the worker. */
  get busy(): boolean {
    return this.capturing || this.inFlight;
  }

  /** True while a start attempt is still resolving (permission prompt, worker init, timeouts). */
  isStarting(): boolean {
    return this.startingFlag;
  }

  async start(): Promise<void> {
    if (this.startingFlag) return this.starting ?? Promise.resolve();
    this.startingFlag = true;
    this.delegates = delegateOverride();
    const attempt = ++this.attempt;
    this.starting = this.doStart(attempt).finally(() => {
      // A timed-out request has already advanced `attempt` and released the flags so Retry can
      // start a fresh request; this old settlement must not clear the new one's state.
      if (attempt === this.attempt) {
        this.startingFlag = false;
        this.starting = null;
      }
    });
    return this.starting;
  }

  private async doStart(attempt: number): Promise<void> {
    // A retry after a worker failure must not leave the previous capture element and stream
    // alive behind the new one.
    this.releaseVideo();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (!window.isSecureContext) {
      this.setCamera('insecure-context', 'Camera needs https:// or localhost.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setCamera('unsupported', 'This browser does not expose a camera API.');
      return;
    }

    this.setCamera('requesting');
    this.armRequestTimeout(attempt);
    try {
      const camera = deviceProfile();
      const stream = await this.openStream(camera);
      if (attempt !== this.attempt) {
        // The prompt was abandoned while the browser still held the permission request. Stop the
        // late stream instead of leaving the camera light on behind a "retry" UI.
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.clearRequestTimeout();
      this.stream = stream;
      const video = this.createCaptureVideo();
      this.video = video;
      video.srcObject = stream;
      document.body.append(video);
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('video element failed to load the camera stream'));
      });
      if (attempt !== this.attempt) {
        this.releaseVideo();
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      await video.play().catch(() => undefined);
      this.startScheduler(video);
      this.setCamera('live');
    } catch (err) {
      // A stale attempt must not tear down the stream a newer attempt already opened.
      if (attempt !== this.attempt) return;
      this.releaseVideo();
      this.stream?.getTracks().forEach((track) => track.stop());
      this.stream = null;
      this.clearRequestTimeout();
      this.setCamera(this.classifyCameraError(err), describeCameraError(err));
      return;
    }

    await this.initWorker(attempt);
  }

  /**
   * The capture element never lives inside a preview. Previews hide, unmount and release their
   * decoder; tracking must keep running regardless. It is mounted (1 px, transparent) because
   * some browsers stop `requestVideoFrameCallback` for an element that is not in the layout;
   * the scheduler's watchdog covers the cases where they still do.
   */
  private createCaptureVideo(): HTMLVideoElement {
    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('aria-hidden', 'true');
    video.tabIndex = -1;
    video.className = 'tracker-capture-video';
    return video;
  }

  private startScheduler(video: HTMLVideoElement): void {
    this.scheduler?.stop();
    // The DOM lib declares rVFC as required, but older browsers still ship without it.
    const requestFrame =
      typeof video.requestVideoFrameCallback === 'function'
        ? (callback: () => void): number => video.requestVideoFrameCallback(() => callback())
        : null;
    const cancelFrame =
      typeof video.cancelVideoFrameCallback === 'function'
        ? (handle: number): void => video.cancelVideoFrameCallback(handle)
        : null;
    this.scheduler = new FrameScheduler({
      onFrame: () => this.pump(),
      requestFrame,
      cancelFrame,
      // A live camera delivers a frame every 16–42 ms. A second without one means rVFC is not
      // firing for this element, not that the camera is slow.
      watchdogAfterMs: 1000
    });
    this.scheduler.start();
  }

  /**
   * Camera constraints follow the device class (audit task 5.1). The stream opened at boot was
   * sized for the class measured then; rotating a tablet or moving the window to an external
   * display changes that class, and the stale request keeps the old resolution and frame rate.
   *
   * Returns true when a fresh stream was actually opened. The tracking worker is untouched — it
   * consumes whatever the video element plays next, and the previews are handed the new stream —
   * so only the media source is swapped.
   */
  async applyCameraProfile(profile: DeviceProfile): Promise<boolean> {
    const video = this.video;
    const stream = this.stream;
    if (this.camera !== 'live' || !stream || !video) return false;

    // Nothing to do when the browser already resolved the stream to the constraints the new class
    // asks for (several devices clamp a small request up to their default size).
    const settings = stream.getVideoTracks()[0]?.getSettings() ?? {};
    const same =
      Math.abs((settings.width ?? 0) - profile.cameraWidth) < 1 &&
      Math.abs((settings.height ?? 0) - profile.cameraHeight) < 1;
    if (same) return false;

    try {
      const next = await this.openStream(profile);
      // Adopt only after the new stream resolves: a failed reopen (camera unplugged, constraints
      // rejected) must leave the working tracker alive.
      stream.getTracks().forEach((track) => track.stop());
      this.stream = next;
      video.srcObject = next;
      await new Promise<void>((resolve, reject) => {
        if (video.readyState >= 2) {
          resolve();
          return;
        }
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('video element failed to load the camera stream'));
      });
      await video.play().catch(() => undefined);
      // Force one fresh frame: the re-opened stream may start at the same currentTime.
      this.lastVideoTime = -1;
      // Re-arm rVFC in case the source swap cancelled the registered callback.
      this.scheduler?.start();
      this.cameraReopens += 1;
      this.setCamera('live');
      return true;
    } catch {
      return false;
    }
  }

  /** Resolved stream settings and reopen count, for the device-profile E2E. */
  deviceState(): {
    streamWidth: number;
    streamHeight: number;
    frameRate: number;
    reopens: number;
  } {
    const track = this.stream?.getVideoTracks()[0];
    const settings = track?.getSettings() ?? {};
    return {
      streamWidth: settings.width ?? 0,
      streamHeight: settings.height ?? 0,
      frameRate: settings.frameRate ?? 0,
      reopens: this.cameraReopens
    };
  }

  private openStream(profile: DeviceProfile): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      // Cellab's proven request is a plain 640x480. No `max` frame-rate cap: a 60 fps camera
      // gives the tracker a fresher frame at capture time and a smoother preview, and the
      // single-flight loop still runs inference as fast as the model allows.
      video: {
        width: { ideal: profile.cameraWidth },
        height: { ideal: profile.cameraHeight },
        frameRate: { ideal: profile.cameraFps },
        facingMode: 'user'
      },
      audio: false
    });
  }

  /**
   * getUserMedia can stay pending forever when the permission prompt is dismissed by the browser
   * chrome rather than denied. Twelve seconds is long enough for a person to answer the prompt and
   * short enough that the onboarding can offer a mouse path instead of a spinner.
   */
  private armRequestTimeout(attempt: number): void {
    this.clearRequestTimeout();
    this.requestTimer = window.setTimeout(() => {
      if (attempt !== this.attempt) return;
      this.attempt += 1;
      this.startingFlag = false;
      this.starting = null;
      this.setCamera(
        'timeout',
        'Camera did not respond. Allow camera access in the browser prompt, then retry — or continue with the mouse.'
      );
    }, 12_000);
  }

  private clearRequestTimeout(): void {
    if (this.requestTimer === null) return;
    window.clearTimeout(this.requestTimer);
    this.requestTimer = null;
  }

  private assetSources(): WorkerAssetSource[] {
    return [
      { wasmBase: resolveAssetPath('mediapipe-wasm'), modelPath: MODEL },
      { wasmBase: CDN_WASM, modelPath: MODEL }
    ];
  }

  /**
   * Spawn the tracking worker and wait for it to report its delegate.
   *
   * A worker that cannot start or whose model fails to load is a hard tracking error: there is no
   * main-thread fallback, because synchronous inference is what made Celly stutter in the first
   * place. The camera keeps streaming — the preview, the skeleton and the mouse path all still
   * work — so the app stays usable while the message says the model is unavailable.
   */
  private initWorker(attempt: number): Promise<void> {
    this.setTracking('initializing');
    if (typeof Worker === 'undefined') {
      return Promise.reject(new Error('This browser cannot run a background tracking worker.'));
    }

    return new Promise<void>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL('./trackingWorker.ts', import.meta.url), { type: 'module' });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.worker = worker;
      this.workerReady = false;
      this.inFlight = false;
      this.capturing = false;
      this.results = [];
      this.lastVideoTime = -1;
      this.frameId = 0;

      const settle = (): void => {
        if (this.initTimer !== null) {
          window.clearTimeout(this.initTimer);
          this.initTimer = null;
        }
      };

      this.initTimer = window.setTimeout(() => {
        if (attempt === this.attempt) {
          reject(new Error('The tracking worker did not report ready in time.'));
        }
      }, WORKER_INIT_TIMEOUT_MS);

      worker.onmessage = (event: MessageEvent<TrackingWorkerResponse>): void => {
        if (attempt !== this.attempt) return;
        const message = event.data;
        switch (message.type) {
          case 'ready':
            settle();
            this.workerReady = true;
            this.detail = describeDelegate(message.source, message.delegate);
            this.setTracking(message.delegate);
            resolve();
            break;
          case 'result':
            // Keep a short bounded history instead of latest-wins: a pinch that starts and ends
            // while the render loop is stalled must still produce both edges.
            this.inFlight = false;
            this.inferenceMs = message.inferenceMs;
            this.lastResultAt = performance.now();
            this.results.push(message.frame);
            if (this.results.length > MAX_RESULTS) this.results.shift();
            this.frames += 1;
            this.noteThroughput();
            break;
          case 'error':
            if (!message.fatal && message.id !== undefined) {
              // Per-frame failure (one corrupt frame, a pre-ready frame): drop it and keep going.
              this.inFlight = false;
              return;
            }
            settle();
            reject(new Error(message.detail));
            break;
          default:
            break;
        }
      };

      worker.onerror = (event): void => {
        if (attempt !== this.attempt) return;
        settle();
        reject(new Error(event.message || 'The tracking worker crashed.'));
      };

      const request: TrackingWorkerRequest = {
        type: 'init',
        attempts: this.assetSources(),
        delegates: this.delegates
      };
      worker.postMessage(request);
    })
      .catch((err: unknown) => {
        if (attempt !== this.attempt) return;
        this.disposeWorker();
        this.setTracking('error', describeWorkerError(err));
      });
  }

  /**
   * Hand every completed detection to the render loop, oldest first. The array is bounded, so a
   * main-thread stall can delay results but never grow an unbounded queue.
   */
  drain(): RawFrame[] {
    if (this.results.length === 0) return [];
    const frames = this.results;
    this.results = [];
    return frames;
  }

  /**
   * Backwards-compatible single-result accessor: returns the newest completed detection and
   * discards older ones. The app uses `drain()` so no pinch edge is lost.
   */
  poll(): RawFrame | null {
    const frame = this.results.length ? this.results[this.results.length - 1] : null;
    this.results = [];
    return frame;
  }

  /**
   * Send exactly one camera frame to the worker, and only when it is idle. Backpressure is what
   * keeps inference from ever queueing up behind itself.
   */
  private pump(): void {
    const worker = this.worker;
    const video = this.video;
    if (!worker || !this.workerReady || !video) return;
    if (video.readyState < 2) return;
    if (this.capturing || this.inFlight) return;
    if (video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;

    const id = ++this.frameId;
    const capturedAt = performance.now();
    this.capturing = true;
    createImageBitmap(video)
      .then((bitmap) => {
        this.capturing = false;
        if (!this.worker || !this.workerReady) {
          bitmap.close();
          return;
        }
        this.inFlight = true;
        this.captures += 1;
        this.noteCapture();
        const request: TrackingWorkerRequest = { type: 'frame', id, bitmap, capturedAt };
        this.worker.postMessage(request, [bitmap]);
      })
      .catch(() => {
        this.capturing = false;
      });
  }

  private noteThroughput(): void {
    const now = performance.now();
    if (now - this.fpsClock >= 1000) {
      this.trackerFps = Math.round((this.frames * 1000) / Math.max(1, now - this.fpsClock));
      this.frames = 0;
      this.fpsClock = now;
    }
  }

  private noteCapture(): void {
    const now = performance.now();
    if (now - this.captureClock >= 1000) {
      // `captures` is a lifetime counter; keep a separate window counter for the rate.
      this.captureFps = Math.round(
        ((this.captures - this.captureWindowStart) * 1000) / Math.max(1, now - this.captureClock)
      );
      this.captureWindowStart = this.captures;
      this.captureClock = now;
    }
  }

  /** Video decoding health (dropped frames), for the diagnostics panel. */
  droppedVideoFrames(): number {
    const quality = this.video?.getVideoPlaybackQuality?.();
    return quality?.droppedVideoFrames ?? 0;
  }

  async stop(): Promise<void> {
    this.attempt += 1;
    this.clearRequestTimeout();
    if (this.initTimer !== null) {
      window.clearTimeout(this.initTimer);
      this.initTimer = null;
    }
    this.startingFlag = false;
    this.starting = null;
    this.scheduler?.stop();
    this.scheduler = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.releaseVideo();
    this.disposeWorker();
    this.setCamera('idle');
    this.setTracking('idle');
  }

  private releaseVideo(): void {
    const video = this.video;
    this.video = null;
    if (!video) return;
    video.pause();
    video.srcObject = null;
    video.remove();
  }

  private disposeWorker(): void {
    const worker = this.worker;
    this.worker = null;
    this.workerReady = false;
    this.results = [];
    this.inFlight = false;
    this.capturing = false;
    this.lastVideoTime = -1;
    this.trackerFps = 0;
    this.captureFps = 0;
    this.frames = 0;
    this.captureWindowStart = this.captures;
    this.captureClock = performance.now();
    this.lastResultAt = 0;
    // terminate() cancels a queued init immediately; a graceful dispose would leave the worker
    // alive for its own shutdown message.
    worker?.terminate();
  }

  private classifyCameraError(err: unknown): CameraStatus {
    const name = (err as { name?: string })?.name ?? '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'not-found';
    if (name === 'NotReadableError' || name === 'AbortError') return 'in-use';
    return 'unsupported';
  }

  private setCamera(status: CameraStatus, detail?: string): void {
    this.camera = status;
    if (detail) this.detail = detail;
    this.cb.onCamera?.(status, detail);
  }

  private setTracking(status: TrackingStatus, detail?: string): void {
    this.tracking = status;
    if (detail) this.detail = detail;
    this.cb.onTracking?.(status, detail);
  }
}

function describeDelegate(source: 'local' | 'cdn', delegate: 'gpu' | 'cpu'): string {
  const where = source === 'cdn' ? 'cdn · worker' : 'local · worker';
  return `${where} ${delegate.toUpperCase()}${source === 'cdn' ? ' (CDN fallback)' : ''}`;
}

function describeWorkerError(err: unknown): string {
  const message = (err as Error)?.message ?? String(err);
  return `Hand tracking is unavailable: ${message} Mouse control still works.`;
}

function describeCameraError(err: unknown): string {
  const name = (err as { name?: string })?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
      return 'Camera permission denied. Enable it in the browser site settings, then retry.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera detected. Plug one in, check the privacy shutter, then retry.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is busy in another app (Zoom, Teams, OBS). Close it and retry.';
    default:
      return (err as Error)?.message ?? 'Camera unavailable. Mouse control still works.';
  }
}
