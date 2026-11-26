import type { GestureState, Language, TrackingQuality } from '../types';
import { el, escapeHtml } from './dom';

export interface HudState {
  hands: number;
  sides: Array<'left' | 'right'>;
  pinchLeft: number;
  pinchRight: number;
  pinchingLeft: boolean;
  pinchingRight: boolean;
  landmarks: number;
  quality: TrackingQuality;
  /** True when the camera and model are live (distinguishes "no hands" from "no signal"). */
  tracking: boolean;
  trackerFps: number;
  renderFps: number;
  mirrorX: boolean;
  mirrorY: boolean;
  swap: boolean;
  gesture: GestureState;
  hint: string;
  /** Resolved source frame rate reported by the camera track. */
  cameraFps: number;
  /** Frames submitted for inference per second. */
  captureFps: number;
  /** Age of the newest detection result, in milliseconds (-1 before the first). */
  ageMs: number;
  inferenceMs: number;
  /** Completed detections waiting for the render loop. */
  queued: number;
  /** Hands the model reported on the newest result, before filtering. */
  rawHands: number;
  /** Frame rate of the live preview's own video element. */
  previewFps: number;
}

export const COPY = {
  en: {
    tracking: 'Tracking',
    hands: 'hands',
    noHands: 'No hands',
    pinch: 'Pinch',
    landmarks: 'Landmarks',
    mirror: 'Mirror',
    swapOn: 'on',
    swapOff: 'off',
    quality: { good: 'Good', medium: 'Medium', poor: 'Poor', none: 'No signal', waiting: 'Waiting' },
    debug: 'Debug',
    tracker: 'Tracker',
    render: 'Render',
    gesture: 'Gesture',
    camera: 'Camera',
    capture: 'Capture',
    preview: 'Preview',
    age: 'Age',
    infer: 'Infer',
    queue: 'Queue',
    raw: 'Raw',
    privacy: 'On-device only'
  },
  fr: {
    tracking: 'Suivi',
    hands: 'mains',
    noHands: 'Aucune main',
    pinch: 'Pincement',
    landmarks: 'Points',
    mirror: 'Miroir',
    swapOn: 'activé',
    swapOff: 'désactivé',
    quality: { good: 'Bon', medium: 'Moyen', poor: 'Faible', none: 'Aucun signal', waiting: 'En attente' },
    debug: 'Débogage',
    tracker: 'Suivi',
    render: 'Rendu',
    gesture: 'Geste',
    camera: 'Caméra',
    capture: 'Capture',
    preview: 'Aperçu',
    age: 'Âge',
    infer: 'Inférence',
    queue: 'File',
    raw: 'Brut',
    privacy: 'Traitement local'
  }
};

export class Hud {
  readonly root: HTMLElement;
  private readonly qualityDot: HTMLElement;
  private readonly qualityLabel: HTMLElement;
  private readonly handsLabel: HTMLElement;
  private leftChip: HTMLElement;
  private rightChip: HTMLElement;
  private leftBar: HTMLElement;
  private rightBar: HTMLElement;
  private leftValue: HTMLElement;
  private rightValue: HTMLElement;
  private landmarksValue: HTMLElement;
  private mirrorValue: HTMLElement;
  private trackerValue: HTMLElement;
  private renderValue: HTMLElement;
  private gestureValue: HTMLElement;
  private copy = COPY.en;
  private language: Language;
  private lastHands = -1;
  onAction: ((action: 'overlay' | 'selection-test') => void) | null = null;

  constructor(language: Language = 'en') {
    this.language = language;
    this.copy = COPY[language];
    this.root = el('aside', 'hud glass');
    this.root.setAttribute('aria-label', 'Hand tracking status');

    this.root.innerHTML = `
      <div class="hud-head">
        <span class="eyebrow" data-i18n="tracking">${escapeHtml(this.copy.tracking)}</span>
        <span class="quality" data-level="none">
          <i class="quality-dot"></i>
          <span class="quality-label">—</span>
        </span>
      </div>
      <div class="hud-hands">
        <span class="hand-chip" data-side="left">L</span>
        <span class="hand-chip" data-side="right">R</span>
        <span class="hud-hands-label">—</span>
      </div>
      <div class="hud-pinch">
        <span class="hud-key">${escapeHtml(this.copy.pinch)}</span>
        <div class="pinch-line"><span class="mini-tag">L</span><div class="bar"><i></i></div><b>0.00</b></div>
        <div class="pinch-line"><span class="mini-tag">R</span><div class="bar"><i></i></div><b>0.00</b></div>
      </div>
      <div class="hud-grid">
        <div class="hud-cell"><span>${escapeHtml(this.copy.landmarks)}</span><b class="landmarks">0 / 42</b></div>
        <div class="hud-cell"><span>${escapeHtml(this.copy.mirror)}</span><b class="mirror">—</b></div>
        <div class="hud-cell"><span>Swap</span><b class="swap">—</b></div>
        <div class="hud-cell"><span>${escapeHtml(this.copy.gesture)}</span><b class="gesture">—</b></div>
      </div>
      <details class="hud-debug">
        <summary>${escapeHtml(this.copy.debug)}</summary>
        <div class="hud-debug-grid">
          <span class="dbg-camera">${escapeHtml(this.copy.camera)}</span><b class="fps-camera">0 fps</b>
          <span class="dbg-preview">${escapeHtml(this.copy.preview)}</span><b class="fps-preview">0 fps</b>
          <span class="dbg-capture">${escapeHtml(this.copy.capture)}</span><b class="fps-capture">0 fps</b>
          <span class="dbg-raw">${escapeHtml(this.copy.raw)}</span><b class="raw-hands">0</b>
          <span class="dbg-age">${escapeHtml(this.copy.age)}</span><b class="result-age">—</b>
          <span class="dbg-infer">${escapeHtml(this.copy.infer)}</span><b class="infer-ms">—</b>
          <span class="dbg-queue">${escapeHtml(this.copy.queue)}</span><b class="queue">0</b>
          <span class="dbg-tracker">${escapeHtml(this.copy.tracker)}</span><b class="fps-tracker">0 fps</b>
          <span class="dbg-render">${escapeHtml(this.copy.render)}</span><b class="fps-render">0 fps</b>
          <span>Jitter</span><b class="jitter">0.000</b>
          <span>Margin</span><b class="margin">0.00</b>
        </div>
        <div class="hud-actions">
          <button type="button" class="hud-action" data-hud="overlay" title="D">Debug overlay</button>
          <button type="button" class="hud-action" data-hud="selection-test" title="T">Selection test</button>
        </div>
      </details>
      <div class="hud-foot">
        <i class="shield"></i><span>${this.copy.privacy}</span>
      </div>
    `;

    this.qualityDot = this.root.querySelector('.quality') as HTMLElement;
    this.qualityLabel = this.root.querySelector('.quality-label') as HTMLElement;
    this.handsLabel = this.root.querySelector('.hud-hands-label') as HTMLElement;
    this.leftChip = this.root.querySelector('.hand-chip[data-side="left"]') as HTMLElement;
    this.rightChip = this.root.querySelector('.hand-chip[data-side="right"]') as HTMLElement;
    const bars = this.root.querySelectorAll('.pinch-line .bar > i');
    this.leftBar = bars[0] as HTMLElement;
    this.rightBar = bars[1] as HTMLElement;
    const values = this.root.querySelectorAll('.pinch-line b');
    this.leftValue = values[0] as HTMLElement;
    this.rightValue = values[1] as HTMLElement;
    this.landmarksValue = this.root.querySelector('.landmarks') as HTMLElement;
    this.mirrorValue = this.root.querySelector('.mirror') as HTMLElement;
    this.trackerValue = this.root.querySelector('.fps-tracker') as HTMLElement;
    this.renderValue = this.root.querySelector('.fps-render') as HTMLElement;
    this.gestureValue = this.root.querySelector('.gesture') as HTMLElement;
    this.root.querySelector('.swap')!.textContent = '—';
    this.root.querySelector('[data-hud="overlay"]')?.addEventListener('click', () => this.onAction?.('overlay'));
    this.root
      .querySelector('[data-hud="selection-test"]')
      ?.addEventListener('click', () => this.onAction?.('selection-test'));
  }

  setLanguage(language: Language): void {
    this.language = language;
    this.copy = COPY[language];
    const set = (sel: string, text: string): void => {
      const n = this.root.querySelector(sel);
      if (n) n.textContent = text;
    };
    set('.eyebrow', this.copy.tracking);
    set('.hud-key', this.copy.pinch);
    const cells = this.root.querySelectorAll('.hud-grid .hud-cell > span');
    if (cells[0]) cells[0].textContent = this.copy.landmarks;
    if (cells[1]) cells[1].textContent = this.copy.mirror;
    if (cells[3]) cells[3].textContent = this.copy.gesture;
    set('.hud-debug > summary', this.copy.debug);
    set('.dbg-camera', this.copy.camera);
    set('.dbg-preview', this.copy.preview);
    set('.dbg-capture', this.copy.capture);
    set('.dbg-raw', this.copy.raw);
    set('.dbg-age', this.copy.age);
    set('.dbg-infer', this.copy.infer);
    set('.dbg-queue', this.copy.queue);
    set('.dbg-tracker', this.copy.tracker);
    set('.dbg-render', this.copy.render);
    set('.hud-foot span', this.copy.privacy);
    this.updateHandsLabel(this.lastHands);
  }

  update(state: HudState): void {
    const q = state.quality;
    this.qualityDot.dataset.level = q.level;
    this.qualityLabel.textContent =
      q.level === 'none'
        ? state.tracking
          ? this.copy.quality.waiting
          : this.copy.quality.none
        : `${this.copy.quality[q.level]} · ${Math.round(q.value * 100)}%`;

    this.updateHandsLabel(state.hands);
    this.leftChip.classList.toggle('is-active', state.sides.includes('left'));
    this.rightChip.classList.toggle('is-active', state.sides.includes('right'));
    this.leftChip.classList.toggle('is-pinching', state.pinchingLeft);
    this.rightChip.classList.toggle('is-pinching', state.pinchingRight);

    this.leftBar.style.transform = `scaleX(${state.pinchLeft.toFixed(3)})`;
    this.rightBar.style.transform = `scaleX(${state.pinchRight.toFixed(3)})`;
    this.leftValue.textContent = state.pinchLeft.toFixed(2);
    this.rightValue.textContent = state.pinchRight.toFixed(2);
    this.leftValue.classList.toggle('is-hot', state.pinchingLeft);
    this.rightValue.classList.toggle('is-hot', state.pinchingRight);

    this.landmarksValue.textContent = `${state.landmarks} / 42`;
    this.mirrorValue.textContent = `X ${state.mirrorX ? 'ON' : 'OFF'} · Y ${state.mirrorY ? 'ON' : 'OFF'}`;
    const swapNode = this.root.querySelector('.swap');
    if (swapNode) swapNode.textContent = state.swap ? this.copy.swapOn : this.copy.swapOff;
    this.gestureValue.textContent = state.gesture === 'IDLE' ? '—' : state.gesture.toLowerCase();
    this.gestureValue.classList.toggle('is-hot', state.gesture !== 'IDLE');

    this.trackerValue.textContent = `${state.trackerFps} fps`;
    this.renderValue.textContent = `${state.renderFps} fps`;
    (this.root.querySelector('.fps-camera') as HTMLElement).textContent = `${state.cameraFps} fps`;
    (this.root.querySelector('.fps-preview') as HTMLElement).textContent = `${state.previewFps} fps`;
    (this.root.querySelector('.fps-capture') as HTMLElement).textContent = `${state.captureFps} fps`;
    (this.root.querySelector('.raw-hands') as HTMLElement).textContent = `${state.rawHands}`;
    (this.root.querySelector('.result-age') as HTMLElement).textContent =
      state.ageMs < 0 ? '—' : `${state.ageMs} ms`;
    (this.root.querySelector('.infer-ms') as HTMLElement).textContent =
      state.inferenceMs <= 0 ? '—' : `${state.inferenceMs.toFixed(1)} ms`;
    (this.root.querySelector('.queue') as HTMLElement).textContent = `${state.queued}`;
    (this.root.querySelector('.jitter') as HTMLElement).textContent = q.jitter.toFixed(4);
    (this.root.querySelector('.margin') as HTMLElement).textContent = q.margin.toFixed(2);
  }

  private updateHandsLabel(hands: number): void {
    this.lastHands = hands;
    if (hands < 0) {
      this.handsLabel.textContent = '—';
      this.root.classList.add('is-idle');
      return;
    }
    if (hands === 0) {
      this.handsLabel.textContent = this.copy.noHands;
    } else if (this.language === 'fr') {
      this.handsLabel.textContent = hands === 1 ? '1 main' : `${hands} mains`;
    } else {
      this.handsLabel.textContent = hands === 1 ? '1 hand' : `${hands} hands`;
    }
    this.root.classList.toggle('is-idle', hands === 0);
  }
}
