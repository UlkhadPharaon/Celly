import type { CameraStatus, RawFrame, TrackingStatus } from '../types';
import { deviceProfile } from '../core/device';
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

/**
 * Webcam + MediaPipe HandLandmarker, with inference off the main thread.
 *
 * Camera frames are converted to an `ImageBitmap` on the main thread and transferred to a
 * dedicated worker that owns the landmarker. At most one frame is in flight at a time — exactly
 * the single-flight + backpressure loop Cellab uses — so a slow inference never queues up and
 * never blocks rendering, gestures or DOM updates. Newest results are handed to the render loop
 * through `poll()`; a result that arrives while the render thread is busy is replaced by the next
 * one, which is indistinguishable at render rate but keeps the loop free.
 */
export class HandTracker {
  camera: CameraStatus = 'idle';
  tracking: TrackingStatus = 'idle';
  detail: string | null = null;
  trackerFps = 0;
  /** Duration of the last worker inference. A health signal only: it never blocks the main thread. */
  inferenceMs = 0;

  video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private workerReady = false;
  private pending: RawFrame | null = null;
  /** A `createImageBitmap` capture is in flight; drop camera frames until it resolves. */
  private capturing = false;
  /** A bitmap has been transferred and the worker owes us a result for it. */
  private inFlight = false;
  private frameId = 0;
  private lastVideoTime = -1;
  private frames = 0;
  private fpsClock = 0;
  private starting: Promise<void> | null = null;
  private startingFlag = false;
  private attempt = 0;
  private requestTimer: number | null = null;
  private initTimer: number | null = null;

  constructor(private readonly cb: TrackerCallbacks = {}) {}

  get ready(): boolean {
    return this.workerReady && this.camera === 'live';
  }

  /** True while a start attempt is still resolving (permission prompt, worker init, timeouts). */
  isStarting(): boolean {
    return this.startingFlag;
  }

  async start(): Promise<void> {
    if (this.startingFlag) return this.starting ?? Promise.resolve();
    this.startingFlag = true;
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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: camera.cameraWidth },
          height: { ideal: camera.cameraHeight },
          frameRate: { ideal: camera.cameraFps, max: camera.cameraFps },
          facingMode: 'user'
        },
        audio: false
      });
      if (attempt !== this.attempt) {
        // The prompt was abandoned while the browser still held the permission request. Stop the
        // late stream instead of leaving the camera light on behind a "retry" UI.
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.clearRequestTimeout();
      this.stream = stream;
      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('video element failed to load the camera stream'));
      });
      if (attempt !== this.attempt) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      await video.play().catch(() => undefined);
      this.video = video;
      this.setCamera('live');
    } catch (err) {
      if (attempt !== this.attempt) return;
      this.clearRequestTimeout();
      this.setCamera(this.classifyCameraError(err), describeCameraError(err));
      return;
    }

    await this.initWorker(attempt);
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
            // Latest result wins; an unconsumed one is dropped, exactly like a dropped camera
            // frame in a single-flight pipeline.
            this.inFlight = false;
            this.inferenceMs = message.inferenceMs;
            this.pending = message.frame;
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

      const request: TrackingWorkerRequest = { type: 'init', attempts: this.assetSources() };
      worker.postMessage(request);
    })
      .catch((err: unknown) => {
        if (attempt !== this.attempt) return;
        this.disposeWorker();
        this.setTracking('error', describeWorkerError(err));
      });
  }

  /**
   * Hand out the newest completed detection, if any. Each result is delivered exactly once:
   * calling again before the next result returns null, which keeps the 250 ms hand-loss tolerance
   * in charge of the gap instead of replaying a stale pose as a new one.
   */
  poll(): RawFrame | null {
    this.pump();
    const frame = this.pending;
    this.pending = null;
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

  async stop(): Promise<void> {
    this.attempt += 1;
    this.clearRequestTimeout();
    if (this.initTimer !== null) {
      window.clearTimeout(this.initTimer);
      this.initTimer = null;
    }
    this.startingFlag = false;
    this.starting = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.disposeWorker();
    this.setCamera('idle');
    this.setTracking('idle');
  }

  private disposeWorker(): void {
    const worker = this.worker;
    this.worker = null;
    this.workerReady = false;
    this.pending = null;
    this.inFlight = false;
    this.capturing = false;
    this.lastVideoTime = -1;
    this.trackerFps = 0;
    this.frames = 0;
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
