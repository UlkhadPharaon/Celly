import type {
  GestureFrame,
  HandFrame,
  HandSide,
  Intent,
  Language,
  PageId,
  RawFrame,
  Settings,
  TrackingQuality,
  Vec3
} from '../types';
import type { OrganelleId } from '../scene/types';
import { SceneManager } from '../scene/sceneManager';
import { HandTracker } from '../tracking/handTracker';
import { HandSideResolver } from '../tracking/handSide';
import { LandmarkFilterBank, motionEnergy } from '../tracking/landmarkFilter';
import { frameMargin, scoreQuality } from '../tracking/quality';
import { DEFAULT_PINCH, PINCH_SENSITIVITY, initialPinch, isFist, pinchValue, updatePinch, type PinchState } from '../gestures/pinch';
import { handRoll, mapNormalized, palmPoint, pinchCursor, unreach } from '../gestures/cursor';
import { GestureEngine } from '../gestures/gestureEngine';
import { HandLayer } from '../scene/handLayer';
import { Shell } from '../ui/shell';
import type { ControlState, ToggleKey } from '../ui/controlPanel';
import { loadJSON, saveJSON } from './store';
import { synthHand } from './replayHand';
import { dist3 } from './math';
import { InteractiveLabPage } from '../pages/interactiveLab';
import { KnowledgePage } from '../pages/knowledge';
import { TestingPage } from '../pages/testing/testingPage';
import type { Page, PageActions } from '../pages/page';
import { KNOWLEDGE_NODES } from '../data/catalog';

const SETTINGS_KEY = 'celly:v02:settings';
const ONBOARD_KEY = 'celly:v02:onboarded';
const HAND_LOSS_MS = 250;
const HUD_INTERVAL_MS = 90;

export const DEFAULT_SETTINGS: Settings = {
  language: 'en',
  mirrorX: true,
  mirrorY: false,
  handsSwap: false,
  showWebcam: true,
  showFeedback: true,
  dwellClick: false,
  autoRotate: true,
  pinchSensitivity: PINCH_SENSITIVITY.normal,
  reducedMotion: false,
  highContrast: false,
  quality: 'high'
};

export class CellyApp {
  private readonly settings: Settings;
  private readonly shell: Shell;
  private readonly scene: SceneManager;
  private readonly tracker: HandTracker;
  private readonly hands = new HandLayer();
  private readonly engine = new GestureEngine();
  private readonly sideResolver = new HandSideResolver();
  private readonly normFilters = new LandmarkFilterBank();
  private readonly worldFilters = new LandmarkFilterBank();
  private readonly pinchStates = new Map<HandSide, PinchState>();
  private readonly lastFrames = new Map<HandSide, HandFrame>();
  private readonly lastSeen = new Map<HandSide, number>();
  private readonly scores = new Map<HandSide, number>();
  private readonly pages = new Map<PageId, Page>();

  private frames: HandFrame[] = [];
  private gestureFrame: GestureFrame | null = null;
  private current: Page | null = null;
  private uiHover: string | null = null;
  private sceneHover: string | null = null;
  private hoverLabel = '';
  private cameraRequested = false;

  private quality: TrackingQuality = { level: 'none', value: 0, jitter: 0, margin: 0 };
  private previousJitter: Vec3[] | null = null;
  private lastHudAt = 0;
  private lastTime = 0;
  private lastTickMs = 0;
  private elapsed = 0;
  private renderFrames = 0;
  private renderClock = 0;
  private renderFps = 0;
  private raf = 0;
  private disposed = false;
  private reducedMotion = false;
  private readonly replay = new Map<HandSide, HandFrame>();
  private readonly replayPinch = new Map<HandSide, boolean>();

  constructor(mount: HTMLElement) {
    this.settings = loadSettings();

    this.shell = new Shell(this.settings, {
      onPage: (page) => this.setPage(page),
      onToggle: (key, value) => this.toggle(key, value),
      onLanguage: (language) => this.setLanguage(language),
      onQuality: (quality) => this.setQuality(quality),
      onPinchSensitivity: (value) => this.setPinchSensitivity(value),
      onHelp: () => this.shell.showHelp(),
      onRetryCamera: () => void this.startCamera(),
      onAutoRotate: () => this.toggleAutoRotate(),
      onEnableCamera: () => void this.startCamera(),
      onOnboardingComplete: (requested) => {
        saveJSON(ONBOARD_KEY, true);
        if (!requested && !this.tracker.ready) this.shell.toast(this.t('mouseMode'), 'info');
      },
      onOverlayClose: () => this.current?.closeOverlay()
    });
    mount.append(this.shell.root);

    const stage = this.shell.root.querySelector('#stage') as HTMLElement;
    this.scene = new SceneManager(stage);
    this.scene.setQuality(this.settings.quality);

    this.tracker = new HandTracker({
      onCamera: (status, detail) => {
        this.shell.controls.setCameraStatus(status, detail);
        if (status === 'live') {
          this.shell.controls.preview.attach(this.tracker.video);
        } else if (status === 'denied' || status === 'not-found' || status === 'in-use' || status === 'insecure-context') {
          this.shell.toast(detail ?? this.t('cameraUnavailable'), 'warn');
          this.shell.onboarding.cameraBlocked(detail ?? this.t('cameraUnavailable'));
        }
      },
      onTracking: (status, detail) => {
        if (status === 'error') this.shell.toast(this.t('trackingFailed'), 'warn');
        if (status === 'gpu' && detail) this.shell.toast(detail, 'success');
      }
    });

    const actions: PageActions = {
      openLab: (organelleId) => {
        this.setPage('interactive');
        (this.pages.get('interactive') as InteractiveLabPage | undefined)?.select(organelleId as OrganelleId);
      },
      openKnowledge: (organelleId) => {
        const node =
          KNOWLEDGE_NODES.find((n) => n.organelleId === organelleId) ??
          KNOWLEDGE_NODES.find((n) => n.id === organelleId);
        this.setPage('knowledge');
        if (node) (this.pages.get('knowledge') as KnowledgePage | undefined)?.focusNode(node.id);
      },
      openTest: (nodeId) => {
        const test = this.pages.get('test') as TestingPage | undefined;
        this.setPage('test');
        if (!test) return;
        if (nodeId) test.openForNode(nodeId);
        else test.returnHome();
      },
      toast: (message, tone) => this.shell.toast(message, tone)
    };

    const context = {
      scene: this.scene,
      registry: this.shell.registry,
      overlay: this.shell.overlay,
      shell: this.shell,
      settings: this.settings,
      actions
    };

    for (const page of [
      new InteractiveLabPage(context),
      new KnowledgePage(context),
      new TestingPage(context)
    ]) {
      this.pages.set(page.id, page);
      this.shell.pageLayer.append(page.root);
    }

    this.applySettings();
    this.setPage('interactive', false);

    this.bindInput();
    this.scene.handGroup.add(this.hands.group);
    void this.hands.init();
    this.boot();
  }

  // ------------------------------------------------------------------- bootstrap

  private async boot(): Promise<void> {
    const onboarded = loadJSON<boolean>(ONBOARD_KEY, false);
    if (!onboarded) {
      window.setTimeout(() => this.shell.onboarding.open(), 520);
      return;
    }
    window.setTimeout(() => void this.startCamera(), 420);
  }

  private async startCamera(): Promise<void> {
    if (this.tracker.ready) return;
    if (this.cameraRequested && this.tracker.camera === 'requesting') return;
    this.cameraRequested = true;
    this.shell.controls.setCameraStatus('requesting');
    await this.tracker.start();
    this.shell.controls.setCameraStatus(this.tracker.camera, this.tracker.detail ?? undefined);
    if (this.tracker.camera === 'live') {
      this.hands.resetCalibration();
    }
  }

  // --------------------------------------------------------------------- settings

  private toggle(key: ToggleKey, value: boolean): void {
    switch (key) {
      case 'showWebcam':
        this.settings.showWebcam = value;
        break;
      case 'showFeedback':
        this.settings.showFeedback = value;
        break;
      case 'mirrorX':
        this.settings.mirrorX = value;
        break;
      case 'mirrorY':
        this.settings.mirrorY = value;
        break;
      case 'swap':
        this.settings.handsSwap = value;
        this.sideResolver.reset();
        this.hands.resetCalibration();
        break;
      case 'dwell':
        this.settings.dwellClick = value;
        break;
      case 'reducedMotion':
        this.settings.reducedMotion = value;
        break;
      case 'highContrast':
        this.settings.highContrast = value;
        break;
      default:
        break;
    }
    this.applySettings();
    this.saveSettings();
    if (key === 'showFeedback' || key === 'swap') this.shell.toast(this.t('saved'), 'success');
  }

  private toggleAutoRotate(): void {
    this.settings.autoRotate = !this.settings.autoRotate;
    this.applySettings();
    this.saveSettings();
  }

  private setLanguage(language: Language): void {
    this.settings.language = language;
    this.shell.setLanguage(language);
    for (const page of this.pages.values()) page.setLanguage(language);
    this.saveSettings();
  }

  private setQuality(quality: Settings['quality']): void {
    this.settings.quality = quality;
    this.scene.setQuality(quality);
    this.shell.setControlState(this.controlState());
    this.saveSettings();
    this.shell.toast(quality === 'high' ? this.t('qualityHigh') : this.t('qualityFast'), 'info');
  }

  private setPinchSensitivity(value: number): void {
    this.settings.pinchSensitivity = Math.min(
      PINCH_SENSITIVITY.max,
      Math.max(PINCH_SENSITIVITY.min, value)
    );
    this.shell.setControlState(this.controlState());
    this.saveSettings();
    this.shell.toast(this.t('pinchSaved'), 'success');
  }

  private controlState(): ControlState {
    return {
      showWebcam: this.settings.showWebcam,
      showFeedback: this.settings.showFeedback,
      mirrorX: this.settings.mirrorX,
      mirrorY: this.settings.mirrorY,
      swap: this.settings.handsSwap,
      dwell: this.settings.dwellClick,
      autoRotate: this.settings.autoRotate,
      pinchSensitivity: this.settings.pinchSensitivity,
      language: this.settings.language,
      quality: this.settings.quality,
      reducedMotion: this.settings.reducedMotion,
      highContrast: this.settings.highContrast
    };
  }

  private applySettings(): void {
    this.shell.setControlState(this.controlState());
    this.reducedMotion = this.settings.reducedMotion;
    const root = document.documentElement;
    root.dataset.reducedMotion = String(this.settings.reducedMotion);
    root.dataset.highContrast = String(this.settings.highContrast);
    this.current?.setAutoRotate?.(this.settings.autoRotate);
  }

  private saveSettings(): void {
    saveJSON(SETTINGS_KEY, this.settings);
  }

  // ---------------------------------------------------------------------- routing

  private setPage(page: PageId, animate = true): void {
    const next = this.pages.get(page);
    if (!next || next === this.current) return;
    this.current?.exit();
    this.current = next;
    this.shell.setPage(page);
    this.scene.goToPage(page, animate);
    this.scene.labGroup.visible = page === 'interactive';
    this.scene.knowledgeGroup.visible = page === 'knowledge';
    this.scene.testGroup.visible = page === 'test';
    next.setAutoRotate?.(this.settings.autoRotate);
    next.enter();
    this.uiHover = null;
    this.sceneHover = null;
    this.engine.reset();
    this.shell.controls.preview.setVisible(this.settings.showWebcam);
    this.shell.refreshButtons();
  }

  // ------------------------------------------------------------------------ input

  private bindInput(): void {
    const canvas = this.scene.renderer.domElement;
    canvas.addEventListener('pointermove', (event: PointerEvent) => {
      if (this.frames.length) return;
      this.mouseHover(event.clientX, event.clientY);
    });
    canvas.addEventListener('pointerleave', () => {
      if (this.frames.length) return;
      this.shell.registry.setHover(null);
      this.current?.setHovered(null);
    });
    canvas.addEventListener('click', (event: MouseEvent) => {
      if (this.frames.length) return;
      const ui = this.shell.registry.hitTest(event.clientX, event.clientY);
      if (ui) {
        this.shell.registry.trigger(ui);
        return;
      }
      const id = this.current?.pick(event.clientX, event.clientY) ?? null;
      if (id) this.current?.onIntent({ type: 'select', id });
      else this.current?.onIntent({ type: 'unselect' });
    });

    window.addEventListener('keydown', (event) => {
      if (event.defaultPrevented) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      switch (event.key) {
        case '1':
          this.setPage('interactive');
          break;
        case '2':
          this.setPage('knowledge');
          break;
        case '3':
          this.setPage('test');
          break;
        case 'r':
        case 'R':
          this.toggleAutoRotate();
          break;
        case 'l':
        case 'L':
          this.setLanguage(this.settings.language === 'en' ? 'fr' : 'en');
          break;
        case 'm':
        case 'M':
          this.toggle('mirrorX', !this.settings.mirrorX);
          break;
        case 'h':
        case 'H':
        case '?':
          this.shell.showHelp();
          break;
        case 'Escape':
          this.current?.closeOverlay();
          break;
        default:
          break;
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        cancelAnimationFrame(this.raf);
      } else if (!this.disposed) {
        this.lastTime = performance.now();
        this.raf = requestAnimationFrame(this.loop);
      }
    });

    window.addEventListener('beforeunload', () => this.dispose());
  }

  private mouseHover(x: number, y: number): void {
    const ui = this.shell.registry.hitTest(x, y);
    this.shell.registry.setHover(ui);
    const scene = ui ? null : (this.current?.pick(x, y) ?? null);
    this.current?.setHovered(scene);
  }

  // ------------------------------------------------------------------- tracking

  private buildFrames(raw: RawFrame | null, dt: number): HandFrame[] {
    const t = raw ? raw.tMs : this.lastTickMs;
    const detections = (raw?.hands ?? []).map((hand) => ({
      label: hand.handedness,
      wrist: hand.landmarks[0] ?? { x: 0.5, y: 0.5, z: 0 },
      score: hand.score
    }));
    const sides = this.sideResolver.resolve(detections, { handsSwap: this.settings.handsSwap }, t);
    const map = {
      width: window.innerWidth,
      height: window.innerHeight,
      mirrorX: this.settings.mirrorX,
      mirrorY: this.settings.mirrorY
    };

    const frames: HandFrame[] = [];
    (raw?.hands ?? []).forEach((hand, i) => {
      if (hand.landmarks.length !== 21) return;
      const side = sides[i] ?? 'right';
      const norm = this.normFilters.filter(`n:${side}`, hand.landmarks, dt);
      const hasWorld = hand.worldLandmarks.length === 21;
      const world = hasWorld
        ? this.worldFilters.filter(`w:${side}`, hand.worldLandmarks, dt)
        : norm.map((p) => ({ ...p }));

      const valid = handVisible(norm) && hand.score > 0.35;
      const fist = isFist(norm);
      const value = pinchValue(norm, hasWorld ? world : [], this.settings.pinchSensitivity);
      const previous = this.pinchStates.get(side) ?? initialPinch();
      const update = updatePinch(previous, value, { fist, valid, tMs: t }, DEFAULT_PINCH);
      this.pinchStates.set(side, update.state);

      const { cursor, ndc } = pinchCursor(norm, map);
      const frame: HandFrame = {
        side,
        present: true,
        pinching: update.state.active,
        pinchValue: value,
        pinchStart: update.start,
        pinchEnd: update.end,
        cursor,
        cursorNdc: ndc,
        palm: palmPoint(norm, map),
        landmarks: norm,
        world,
        handScale: Math.max(0.03, dist3(world[0], world[9])),
        wrist: norm[0],
        roll: handRoll(norm),
        tMs: t
      };
      frames.push(frame);
      this.lastFrames.set(side, frame);
      this.lastSeen.set(side, t);
      this.scores.set(side, hand.score);
    });

    // 250 ms hand-loss tolerance: keep the last pose alive but end any gesture.
    for (const side of ['left', 'right'] as const) {
      if (frames.some((f) => f.side === side)) continue;
      const last = this.lastFrames.get(side);
      const seen = this.lastSeen.get(side) ?? -Infinity;
      if (last && t - seen < HAND_LOSS_MS) {
        frames.push({
          ...last,
          pinching: false,
          pinchValue: 0,
          pinchStart: false,
          pinchEnd: last.pinching
        });
      } else {
        this.lastFrames.delete(side);
        this.scores.delete(side);
        this.pinchStates.set(side, initialPinch());
      }
    }
    return frames;
  }

  private tick(): void {
    if (this.replay.size) {
      this.frames = [...this.replay.values()];
      this.updateHover();
      this.stepGestures(performance.now());
      // One-shot edges, exactly like a real detection frame.
      for (const frame of this.frames) {
        frame.pinchStart = false;
        frame.pinchEnd = false;
      }
      return;
    }

    const raw = this.tracker.ready ? this.tracker.detect() : null;
    // Build frames every tick, camera or not: with no tracker and no synthetic hands this is
    // an empty list, but it is also what ages the 250 ms tolerance out and lets the gesture
    // engine retire cursors, hints and hover when the hands leave the frame.
    this.frames = this.buildFrames(raw, 1 / 30);
    this.updateHover();
    this.stepGestures(raw ? raw.tMs : this.lastTickMs);

    if (this.gestureFrame && !this.settings.dwellClick) this.shell.registry.setDwell(null, 0);
    else if (this.gestureFrame?.dwellProgress) {
      this.shell.registry.setDwell(this.uiHover, this.gestureFrame.dwellProgress);
    }
  }

  private stepGestures(t: number): void {
    this.gestureFrame = this.engine.step({
      t,
      hands: this.frames,
      uiHover: this.uiHover,
      sceneHover: this.sceneHover,
      swipeEnabled: this.current?.id !== 'interactive',
      rotateEnabled: true,
      scaleEnabled: true,
      dwellEnabled: this.settings.dwellClick
    });
    this.dispatch(this.gestureFrame.intents);
  }

  private updateHover(): void {
    const primary = primaryHand(this.frames);
    if (!primary) {
      this.uiHover = null;
      this.sceneHover = null;
      this.hoverLabel = '';
      this.current?.setHovered(null);
      this.shell.registry.setHover(null);
      return;
    }
    this.uiHover = this.shell.registry.hitTest(primary.cursor.x, primary.cursor.y);
    this.sceneHover = this.uiHover ? null : (this.current?.pick(primary.cursor.x, primary.cursor.y) ?? null);
    this.hoverLabel = this.sceneHover ? prettify(this.sceneHover) : '';
    this.shell.registry.setHover(this.uiHover);
    this.current?.setHovered(this.sceneHover);
  }

  private dispatch(intents: Intent[]): void {
    for (const intent of intents) {
      switch (intent.type) {
        case 'click':
          this.shell.registry.setPressed(intent.id);
          this.shell.registry.trigger(intent.id);
          window.setTimeout(() => this.shell.registry.setPressed(null), 150);
          break;
        case 'hover':
          break;
        case 'state':
          break;
        default:
          this.current?.onIntent(intent);
          break;
      }
    }
  }

  private updateHud(now: number): void {
    if (now - this.lastHudAt < HUD_INTERVAL_MS) return;
    this.lastHudAt = now;
    const primary = primaryHand(this.frames);
    const jitter = primary ? motionEnergy(this.previousJitter, primary.landmarks) : 0;
    if (primary) this.previousJitter = primary.landmarks.map((p) => ({ ...p }));
    this.quality = scoreQuality({
      hands: this.frames.filter((f) => f.present).length,
      scores: [...this.scores.values()],
      jitter,
      trackerFps: this.tracker.trackerFps,
      margin: frameMargin(this.frames.map((f) => f.landmarks))
    });

    const left = this.frames.find((f) => f.side === 'left');
    const right = this.frames.find((f) => f.side === 'right');
    this.shell.updateHud({
      hands: this.frames.filter((f) => f.present).length,
      sides: this.frames.map((f) => f.side),
      pinchLeft: left?.pinchValue ?? 0,
      pinchRight: right?.pinchValue ?? 0,
      pinchingLeft: !!left?.pinching,
      pinchingRight: !!right?.pinching,
      landmarks: this.frames.filter((f) => f.present).length * 21,
      quality: this.quality,
      tracking: this.tracker.ready,
      trackerFps: this.tracker.trackerFps,
      renderFps: this.renderFps,
      mirrorX: this.settings.mirrorX,
      mirrorY: this.settings.mirrorY,
      swap: this.settings.handsSwap,
      gesture: this.gestureFrame?.state ?? 'IDLE',
      hint: this.gestureFrame?.hint ?? ''
    });
  }

  private updateCursors(): void {
    const cursors =
      this.gestureFrame?.cursors ??
      this.frames
        .filter((f) => f.present)
        .map((f) => ({
          side: f.side,
          x: f.cursor.x,
          y: f.cursor.y,
          visible: true,
          active: f.side === primaryHand(this.frames)?.side,
          pinchValue: f.pinchValue,
          mode: (f.pinching ? 'pinch' : 'pointer') as 'pinch' | 'pointer' | 'passive'
        }));
    this.shell.cursors.update(
      cursors,
      this.gestureFrame?.hint ?? '',
      this.uiHover ? (this.gestureFrame?.dwellProgress ?? 0) : 0,
      this.hoverLabel,
      this.shell.overlay.bounds()
    );
  }

  // ------------------------------------------------------------------------ loop

  private loop = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);

    const dt = Math.min(0.05, Math.max(0.0001, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.lastTickMs = now;
    this.elapsed += dt;

    this.renderFrames += 1;
    this.renderClock += dt;
    if (this.renderClock >= 0.5) {
      this.renderFps = Math.round(this.renderFrames / this.renderClock);
      this.renderFrames = 0;
      this.renderClock = 0;
    }

    this.tick();
    this.hands.update(this.frames, this.settings, dt, this.scene.camera);
    this.current?.update(dt, this.elapsed);
    this.shell.controls.preview.draw(this.frames, this.settings);
    this.updateCursors();
    this.updateHud(now);
    this.scene.render(this.reducedMotion ? dt * 0.35 : dt);
  };

  start(): void {
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ test hooks

  /**
   * Injects a synthetic hand so screenshots and e2e specs can drive the whole pipeline
   * (hover → gesture engine → intents) without a physical camera or a video file.
   * Coordinates are CSS pixels relative to the viewport.
   */
  injectHand(side: HandSide, x: number, y: number, pinch = 0, present = true): void {
    if (!present) {
      this.replay.delete(side);
      this.replayPinch.delete(side);
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    // The pipeline mirrors and reach-maps normalised landmarks on display (D-16, D-39), so build
    // the hand at the pre-mirror, pre-reach position: the cursor the engine sees then lands exactly
    // on (x, y), and the 3D hand is drawn under it instead of near the opposite edge.
    const nx = unreach(x / w);
    const ny = unreach(y / h);
    const synthetic = synthHand(
      side,
      (this.settings.mirrorX ? 1 - nx : nx) * w,
      (this.settings.mirrorY ? 1 - ny : ny) * h,
      pinch,
      { width: w, height: h }
    );
    const pinching = pinch > DEFAULT_PINCH.enter;
    const wasPinching = this.replayPinch.get(side) ?? false;
    this.replayPinch.set(side, pinching);
    this.replay.set(side, {
      side,
      present: true,
      pinching,
      pinchValue: pinch,
      pinchStart: pinching && !wasPinching,
      pinchEnd: !pinching && wasPinching,
      cursor: { x, y },
      cursorNdc: { x: (x / w) * 2 - 1, y: -((y / h) * 2 - 1) },
      palm: synthetic.palm,
      landmarks: synthetic.landmarks,
      world: synthetic.world,
      handScale: synthetic.handScale,
      wrist: synthetic.landmarks[0],
      roll: synthetic.roll,
      tMs: performance.now()
    });
  }

  clearInjectedHands(): void {
    this.replay.clear();
    this.replayPinch.clear();
  }

  /** Screen position of an organelle / knowledge node, or null when it is off-screen. */
  sceneAnchor(id: string): { x: number; y: number } | null {
    const page = this.current;
    if (!page) return null;
    if (page.id === 'interactive') return (page as InteractiveLabPage).screenPosition(id as OrganelleId);
    if (page.id === 'knowledge') return (page as KnowledgePage).screenPosition(id);
    return null;
  }

  /** Direct access for specs that assert on internal state. */
  get state(): { page: PageId | null; hands: number; uiHover: string | null; sceneHover: string | null } {
    return {
      page: this.current?.id ?? null,
      hands: this.frames.length,
      uiHover: this.uiHover,
      sceneHover: this.sceneHover
    };
  }

  /** Test hook: where the pipeline thinks the cursor is versus where the 3D hand sits. */
  debugHand(side: HandSide): Record<string, unknown> {
    const frame = this.frames.find((f) => f.side === side && f.present);
    const container = this.hands.debugContainer(side);
    if (!frame || !container) return { side, present: false };
    const mapped = mapNormalized(frame.landmarks[0], {
      width: window.innerWidth,
      height: window.innerHeight,
      mirrorX: this.settings.mirrorX,
      mirrorY: this.settings.mirrorY
    });
    const p = container.position;
    return {
      side,
      present: true,
      cursor: [Math.round(frame.cursor.x), Math.round(frame.cursor.y)],
      wristScreen: [Math.round(mapped.x), Math.round(mapped.y)],
      containerScreen: [
        Math.round((p.x / 5.9 + 0.5) * window.innerWidth),
        Math.round((0.5 - (p.y + 0.3) / 3.7) * window.innerHeight)
      ],
      container: [Number(p.x.toFixed(3)), Number(p.y.toFixed(3)), Number(p.z.toFixed(3))],
      scale: Number(container.scale.x.toFixed(3))
    };
  }

  private t(key: keyof typeof STRINGS.en): string {
    return STRINGS[this.settings.language][key];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    void this.tracker.stop();
    this.hands.dispose();
    for (const page of this.pages.values()) page.dispose();
    this.scene.dispose();
    this.shell.destroy();
  }
}

function primaryHand(frames: HandFrame[]): HandFrame | null {
  return frames.find((f) => f.present && f.side === 'right') ?? frames.find((f) => f.present) ?? null;
}

/** Every pinch landmark must sit inside the frame for a pinch to register. */
function handVisible(landmarks: Vec3[]): boolean {
  for (const index of [0, 4, 8, 9]) {
    const p = landmarks[index];
    if (!p) return false;
    if (p.x < 0.004 || p.x > 0.996 || p.y < 0.004 || p.y > 0.996) return false;
  }
  return true;
}

function prettify(id: string): string {
  const text = id.replace(/[-_]/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const STRINGS = {
  en: {
    mouseMode: 'Mouse mode — pinch gestures need a camera.',
    cameraUnavailable: 'Camera unavailable.',
    trackingFailed: 'Hand model failed to load. Reload the page to retry.',
    saved: 'Saved',
    pinchSaved: 'Pinch sensitivity saved',
    qualityHigh: 'High quality',
    qualityFast: 'Fast mode'
  },
  fr: {
    mouseMode: 'Mode souris — les gestes nécessitent une caméra.',
    cameraUnavailable: 'Caméra indisponible.',
    trackingFailed: 'Le modèle de main n’a pas pu être chargé. Rechargez la page.',
    saved: 'Enregistré',
    pinchSaved: 'Sensibilité du pincement enregistrée',
    qualityHigh: 'Qualité élevée',
    qualityFast: 'Mode rapide'
  }
};

function loadSettings(): Settings {
  const stored = loadJSON<Partial<Settings>>(SETTINGS_KEY, {});
  const merged: Settings = { ...DEFAULT_SETTINGS, ...stored };
  if (merged.language !== 'fr' && merged.language !== 'en') merged.language = 'en';
  if (merged.quality !== 'low' && merged.quality !== 'high') merged.quality = 'high';
  if (!Number.isFinite(merged.pinchSensitivity)) merged.pinchSensitivity = PINCH_SENSITIVITY.normal;
  merged.pinchSensitivity = Math.min(
    PINCH_SENSITIVITY.max,
    Math.max(PINCH_SENSITIVITY.min, merged.pinchSensitivity)
  );
  return merged;
}
