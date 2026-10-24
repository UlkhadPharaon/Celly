import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { CameraStatus, RawFrame, RawHand, TrackingStatus, Vec3 } from '../types';
import { deviceProfile } from '../core/device';

export interface TrackerCallbacks {
  onCamera?: (status: CameraStatus, detail?: string) => void;
  onTracking?: (status: TrackingStatus, detail?: string) => void;
}

export function resolveAssetPath(relative: string): string {
  const base = new URL('.', document.baseURI);
  return new URL(relative, base).href;
}

function toVec3(p: { x: number; y: number; z: number }): Vec3 {
  return { x: p.x, y: p.y, z: p.z };
}

/**
 * Webcam + MediaPipe HandLandmarker (VIDEO mode, 2 hands, GPU with CPU fallback).
 *
 * The wasm runtime and the .task model are served locally so the app is offline-capable.
 * If the local fileset cannot initialise (corrupt checkout), we retry once against the
 * pinned CDN and report which path is live.
 */
export class HandTracker {
  camera: CameraStatus = 'idle';
  tracking: TrackingStatus = 'idle';
  detail: string | null = null;
  trackerFps = 0;

  video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private landmarker: HandLandmarker | null = null;
  private lastTs = 0;
  private lastVideoTime = -1;
  private frames = 0;
  private fpsClock = 0;
  private starting: Promise<void> | null = null;
  private startingFlag = false;

  constructor(private readonly cb: TrackerCallbacks = {}) {}

  get ready(): boolean {
    return !!this.landmarker && this.camera === 'live';
  }

  async start(): Promise<void> {
    if (this.startingFlag) return this.starting ?? Promise.resolve();
    this.startingFlag = true;
    this.starting = this.doStart().finally(() => {
      this.startingFlag = false;
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart(): Promise<void> {
    if (!window.isSecureContext) {
      this.setCamera('insecure-context', 'Camera needs https:// or localhost.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setCamera('unsupported', 'This browser does not expose a camera API.');
      return;
    }

    this.setCamera('requesting');
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
      await video.play().catch(() => undefined);
      this.video = video;
      this.setCamera('live');
    } catch (err) {
      this.setCamera(this.classifyCameraError(err), describeCameraError(err));
      return;
    }

    await this.initLandmarker();
  }

  private async initLandmarker(): Promise<void> {
    this.setTracking('initializing');
    const modelPath = resolveAssetPath('models/hand_landmarker.task');

    type Attempt = { landmarker: HandLandmarker; delegate: 'gpu' | 'cpu' };

    const attempt = async (wasmBase: string): Promise<Attempt> => {
      const vision = await FilesetResolver.forVisionTasks(wasmBase);
      try {
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: modelPath, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        return { landmarker, delegate: 'gpu' };
      } catch {
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: modelPath, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        return { landmarker, delegate: 'cpu' };
      }
    };

    try {
      const local = await attempt(resolveAssetPath('mediapipe-wasm'));
      this.landmarker = local.landmarker;
      this.detail = `local · ${local.delegate.toUpperCase()}`;
      this.setTracking(local.delegate);
    } catch (localErr) {
      try {
        const cdn = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';
        const remote = await attempt(cdn);
        this.landmarker = remote.landmarker;
        this.detail = `cdn · ${remote.delegate.toUpperCase()} (CDN fallback)`;
        this.setTracking(remote.delegate);
      } catch {
        this.setTracking('error', String(localErr));
      }
    }
  }

  /** Run inference at most once per new video frame. */
  detect(): RawFrame | null {
    const video = this.video;
    const lm = this.landmarker;
    if (!video || !lm || video.readyState < 2) return null;
    if (video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;

    const now = performance.now();
    if (now - this.fpsClock > 1000) {
      this.trackerFps = Math.round((this.frames * 1000) / Math.max(1, now - this.fpsClock));
      this.frames = 0;
      this.fpsClock = now;
    }
    this.frames++;

    // MediaPipe requires strictly increasing timestamps.
    let ts = now;
    if (ts <= this.lastTs) ts = this.lastTs + 0.001;
    this.lastTs = ts;

    let result: HandLandmarkerResult;
    try {
      result = lm.detectForVideo(video, ts);
    } catch {
      return null;
    }

    const hands: RawHand[] = [];
    for (let i = 0; i < result.landmarks.length; i++) {
      const cat = result.handednesses[i]?.[0];
      hands.push({
        handedness: (cat?.categoryName as RawHand['handedness']) ?? 'Unknown',
        score: cat?.score ?? 0,
        landmarks: result.landmarks[i].map(toVec3),
        // MediaPipe world space is metric but image-aligned: x right, y down, z negative
        // towards the camera. Convert once, here, to the renderer's y-up / +z-towards-viewer
        // frame so the rig never has to know about the tracker's convention.
        worldLandmarks: (result.worldLandmarks[i] ?? []).map((p) => ({ x: p.x, y: -p.y, z: -p.z }))
      });
    }
    return { hands, tMs: now };
  }

  async stop(): Promise<void> {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.landmarker?.close();
    this.landmarker = null;
    this.setCamera('idle');
    this.setTracking('idle');
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
