import type { HandFrame, Settings } from '../types';

const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
];

/**
 * Webcam thumbnail with a live landmark skeleton.
 *
 * The camera image is a native `<video>` element: the compositor presents camera frames as
 * they arrive, without a canvas copy and without waiting for the Three.js render loop. The
 * transparent canvas above it only draws the hand overlay, so a slow render tick can delay
 * the skeleton but never the camera feed.
 *
 * Each preview owns its own video element because the tracker's capture element must stay
 * detached from the UI. Hiding a preview releases its decoder; tracking continues because the
 * capture element is a separate video fed by the same MediaStream.
 */
export class WebcamPreview {
  readonly root: HTMLElement;
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly empty: HTMLElement;
  private readonly badge: HTMLElement;
  private stream: MediaStream | null = null;
  private onScreen = true;
  private lastMirror: boolean | null = null;
  /** Passive preview-throughput counter (rVFC on this element's own video). Not a clock. */
  private previewHandle = 0;
  private previewFrames = 0;
  private previewClock = 0;
  private previewFpsValue = 0;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'preview';
    this.root.innerHTML = `
      <video class="preview-video" muted playsinline autoplay aria-hidden="true"></video>
      <canvas class="preview-canvas" width="320" height="180" aria-hidden="true"></canvas>
      <div class="preview-empty">
        <span class="preview-empty-icon"></span>
        <span>Camera off</span>
      </div>
      <div class="preview-badge is-hidden"><i></i><span>LIVE</span></div>
      <div class="preview-reach"></div>
      <div class="preview-corner tl"></div><div class="preview-corner tr"></div>
      <div class="preview-corner bl"></div><div class="preview-corner br"></div>
    `;
    this.video = this.root.querySelector('video') as HTMLVideoElement;
    this.canvas = this.root.querySelector('canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.empty = this.root.querySelector('.preview-empty') as HTMLElement;
    this.badge = this.root.querySelector('.preview-badge') as HTMLElement;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;

    // A camera that is not 16:9 (most 640x480 webcams are 4:3) must not be stretched into the
    // 16:9 box: `object-fit: fill` squeezed the height and widened the image. Sizing the frame to
    // the real stream keeps the picture undistorted, and because the landmark overlay uses the
    // same normalised coordinates, the skeleton stays registered without any crop maths.
    this.video.addEventListener('loadedmetadata', () => this.fitToStream());
  }

  /** Match the frame's aspect ratio to the delivered stream (4:3, 16:9, or anything else). */
  private fitToStream(): void {
    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    if (!width || !height) return;
    this.root.style.aspectRatio = `${width} / ${height}`;
  }

  /** Adopt the live camera stream. `null` stops the local decoder. */
  attachStream(stream: MediaStream | null): void {
    if (this.stream === stream) return;
    this.stream = stream;
    if (!stream) {
      this.releaseVideo();
      return;
    }
    if (this.onScreen) this.playVideo();
  }

  setVisible(visible: boolean): void {
    if (this.onScreen === visible) return;
    this.onScreen = visible;
    this.root.classList.toggle('is-hidden', !visible);
    if (visible) this.playVideo();
    else this.releaseVideo();
  }

  setStatus(live: boolean, label: string): void {
    this.empty.classList.toggle('is-hidden', live);
    this.badge.classList.toggle('is-hidden', !live);
    const span = this.empty.querySelector('span:last-child');
    if (span) span.textContent = label;
  }

  /** True while this preview is on screen (not hidden and holding the stream). */
  get visible(): boolean {
    return this.onScreen;
  }

  /** True when the preview has a playing video element with decoded frames. */
  get playing(): boolean {
    return (
      this.onScreen &&
      !!this.stream &&
      this.video.srcObject === this.stream &&
      this.video.readyState >= 2 &&
      !this.video.paused
    );
  }

  /**
   * Displayed video rate. This is the number the mission's telemetry table asks for: the old
   * canvas-copy preview had no such signal, so nobody could tell whether the camera feed itself
   * was dropping frames or only the redraw was slow. Measured with `requestVideoFrameCallback`
   * on this element's own decoder, independent of the Three.js render loop.
   */
  get previewFps(): number {
    return this.previewFpsValue;
  }

  /** Arm the passive frame counter for this element's decoder. */
  private armPreviewCounter(): void {
    const video = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: (now: number, metadata: unknown) => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    if (typeof video.requestVideoFrameCallback !== 'function') return;
    if (this.previewHandle !== 0) return;
    this.previewClock = performance.now();
    this.previewFrames = 0;
    const tick = (): void => {
      this.previewHandle = 0;
      if (!this.playing) return;
      this.previewFrames += 1;
      const now = performance.now();
      if (now - this.previewClock >= 1000) {
        this.previewFpsValue = Math.round((this.previewFrames * 1000) / (now - this.previewClock));
        this.previewFrames = 0;
        this.previewClock = now;
      }
      // Re-arm before any further work so a slow overlay draw cannot stop the counter.
      this.previewHandle = video.requestVideoFrameCallback!(tick);
    };
    this.previewHandle = video.requestVideoFrameCallback!(tick);
  }

  private stopPreviewCounter(): void {
    if (this.previewHandle === 0) return;
    const video = this.video as HTMLVideoElement & {
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    video.cancelVideoFrameCallback?.(this.previewHandle);
    this.previewHandle = 0;
  }

  draw(hands: HandFrame[], settings: Settings): void {
    const ctx = this.ctx;
    if (!ctx || !this.onScreen) return;

    if (this.lastMirror !== settings.mirrorX) {
      this.lastMirror = settings.mirrorX;
      this.video.style.transform = settings.mirrorX ? 'scaleX(-1)' : 'none';
    }

    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!settings.showFeedback) return;

    for (const hand of hands) {
      if (!hand.present) continue;
      const color = hand.side === 'left' ? '#7ee0c3' : '#ffd166';
      const points = hand.landmarks.map((p) => ({
        x: (settings.mirrorX ? 1 - p.x : p.x) * w,
        y: p.y * h
      }));
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      for (const [a, b] of CONNECTIONS) {
        ctx.moveTo(points[a].x, points[a].y);
        ctx.lineTo(points[b].x, points[b].y);
      }
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      for (const p of points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.9, 0, Math.PI * 2);
        ctx.fill();
      }

      // Gaze / pointer ring sits on the index fingertip (landmark 8); when pinching, also show
      // the pinch contact ring at the thumb-index midpoint.
      const thumb = points[4];
      const index = points[8];
      ctx.beginPath();
      ctx.strokeStyle = hand.pinching ? '#ffd166' : 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.6;
      ctx.arc(index.x, index.y, hand.pinching ? 6 : 4.5, 0, Math.PI * 2);
      ctx.stroke();

      if (hand.pinching) {
        const mx = (thumb.x + index.x) / 2;
        const my = (thumb.y + index.y) / 2;
        ctx.beginPath();
        ctx.strokeStyle = '#ff9f45';
        ctx.lineWidth = 1.4;
        ctx.arc(mx, my, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private playVideo(): void {
    const stream = this.stream;
    if (!stream) return;
    if (this.video.srcObject !== stream) this.video.srcObject = stream;
    void this.video.play().catch(() => undefined);
    this.armPreviewCounter();
  }

  private releaseVideo(): void {
    this.stopPreviewCounter();
    this.previewFpsValue = 0;
    this.video.pause();
    this.video.srcObject = null;
  }
}
