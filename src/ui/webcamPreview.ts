import type { HandFrame, Settings } from '../types';

const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
];

/** Webcam thumbnail with a live landmark skeleton. */
export class WebcamPreview {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly empty: HTMLElement;
  private readonly badge: HTMLElement;
  private source: HTMLVideoElement | null = null;
  private visible = true;
  private lastDraw = 0;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'preview';
    this.root.innerHTML = `
      <canvas class="preview-canvas" width="320" height="180"></canvas>
      <div class="preview-empty">
        <span class="preview-empty-icon"></span>
        <span>Camera off</span>
      </div>
      <div class="preview-badge"><i></i><span>LIVE</span></div>
      <div class="preview-reach"></div>
      <div class="preview-corner tl"></div><div class="preview-corner tr"></div>
      <div class="preview-corner bl"></div><div class="preview-corner br"></div>
    `;
    this.canvas = this.root.querySelector('canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.empty = this.root.querySelector('.preview-empty') as HTMLElement;
    this.badge = this.root.querySelector('.preview-badge') as HTMLElement;
  }

  attach(video: HTMLVideoElement | null): void {
    this.source = video;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.classList.toggle('is-hidden', !visible);
  }

  setStatus(live: boolean, label: string): void {
    this.empty.classList.toggle('is-hidden', live);
    this.badge.classList.toggle('is-hidden', !live);
    const span = this.empty.querySelector('span:last-child');
    if (span) span.textContent = label;
  }

  draw(hands: HandFrame[], settings: Settings, now = performance.now()): void {
    const ctx = this.ctx;
    if (!ctx || !this.visible) return;
    // The main scene renders at display rate; a 320x180 camera thumbnail with landmarks does
    // not need 60 redraws per second. Roughly 15 fps also keeps the canvas off the critical path.
    if (now - this.lastDraw < 66) return;
    this.lastDraw = now;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#03080f';
    ctx.fillRect(0, 0, w, h);

    if (this.source && this.source.readyState >= 2) {
      ctx.save();
      if (settings.mirrorX) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.globalAlpha = 0.82;
      ctx.drawImage(this.source, 0, 0, w, h);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    if (!settings.showFeedback) return;

    for (const hand of hands) {
      if (!hand.present) continue;
      const color = hand.side === 'left' ? '#57c8ff' : '#b39dff';
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

      // Pinch cursor on the preview.
      const thumb = points[4];
      const index = points[8];
      const mx = (thumb.x + index.x) / 2;
      const my = (thumb.y + index.y) / 2;
      ctx.beginPath();
      ctx.strokeStyle = hand.pinching ? '#ffd166' : 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.4;
      ctx.arc(mx, my, hand.pinching ? 7 : 4.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
