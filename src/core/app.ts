import type {
  CameraStatus,
  HandFrame,
  HandSide,
  Intent,
  Language,
  PageId,
  RawFrame,
  Settings,
  TrackingQuality,
  TrackingStatus,
  Vec2,
  Vec3
} from '../types';
import type { OrganelleId } from '../scene/types';
import { SceneManager } from '../scene/sceneManager';
import { HandTracker } from '../tracking/handTracker';
import { motionEnergy } from '../tracking/landmarkFilter';
import { frameMargin, scoreQuality } from '../tracking/quality';
import { DEFAULT_PINCH, PINCH_SENSITIVITY } from '../gestures/pinch';
import {
  mapNormalized,
  pinchContact,
  toNDC,
  unreach
} from '../gestures/cursor';
import { GESTURE_HINTS_FR } from '../gestures/hints';
import { HandLayer } from '../scene/handLayer';
import { DebugOverlay } from '../ui/debugOverlay';
import { Shell } from '../ui/shell';
import type { ControlState, ToggleKey } from '../ui/controlPanel';
import { loadJSON, saveJSON } from './store';
import { SETTINGS_VERSION, sanitizeSettings } from './settings';
import { APP_STRINGS } from './strings';
import { synthHand } from './replayHand';
import { buildPose, buildPoseSequence, type PoseData, type PoseName } from './handPoses';
import { clamp, dist3 } from './math';
import { FrameProcessor } from './frameProcessor';
import { InteractiveLabPage } from '../pages/interactiveLab';
import { KnowledgePage } from '../pages/knowledge';
import { TestingPage } from '../pages/testing/testingPage';
import type { Page, PageActions } from '../pages/page';
import { KNOWLEDGE_NODES } from '../data/catalog';

const SETTINGS_KEY = 'celly:v02:settings';
const ONBOARD_KEY = 'celly:v02:onboarded';
const HUD_INTERVAL_MS = 90;

export class CellyApp {
  private readonly settings: Settings;
  private readonly shell: Shell;
  private readonly scene: SceneManager;
  private readonly tracker: HandTracker;
  private readonly hands = new HandLayer();
  /** Per-frame hand pipeline: filters, pinch hysteresis, aim locks, hover and gestures. */
  private readonly fp: FrameProcessor;
  private readonly pages = new Map<PageId, Page>();
  private readonly debug = new DebugOverlay();

  private current: Page | null = null;
  private cameraAttemptCount = 0;
  private debugVisible = false;

  private quality: TrackingQuality = { level: 'none', value: 0, jitter: 0, margin: 0 };
  private previousJitter: Vec3[] | null = null;
  private lastHudAt = 0;
  private lastTime = 0;
  private lastTickMs = 0;
  /** Capture time of the previous detection, used to pace the landmark filters. */
  private lastDetectionMs = 0;
  /** Ambient clock for the pages. Frozen while reduce motion is on (audit task 3.1). */
  private motionElapsed = 0;
  private renderFrames = 0;
  private renderClock = 0;
  private framesRendered = 0;
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
      onResetProgress: () => this.resetProgress(),
      onOnboardingComplete: () => {
        saveJSON(ONBOARD_KEY, true);
      },
      onOverlayClose: () => this.current?.closeOverlay()
    });
    mount.append(this.shell.root);
    document.body.append(this.debug.root);
    this.fp = new FrameProcessor(this.settings, () => this.current, this.shell.registry);
    this.shell.hud.onAction = (action) => {
      if (action === 'overlay') this.toggleDebugOverlay();
      else this.toggleSelectionTest();
    };

    const stage = this.shell.root.querySelector('#stage') as HTMLElement;
    this.scene = new SceneManager(stage);
    this.scene.setQuality(this.settings.quality);

    this.tracker = new HandTracker({
      onCamera: (status, detail) => {
        this.shell.controls.setCameraStatus(status, detail);
        this.shell.onboarding.setCameraStatus(status, detail);
        if (status === 'live') {
          this.shell.controls.preview.attach(this.tracker.video);
          this.shell.onboarding.attachVideo(this.tracker.video);
        } else if (isCameraError(status)) {
          // The onboarding carries the same message inline in its camera step; a toast behind
          // the modal would only duplicate it and cover the card.
          if (!this.shell.onboarding.isOpen) {
            this.shell.toast(detail ?? this.t('cameraUnavailable'), 'warn');
          }
        }
      },
      onTracking: (status, detail) => {
        if (status === 'error' && !this.shell.onboarding.isOpen) {
          this.shell.toast(this.t('trackingFailed'), 'warn');
        }
        if (status === 'gpu' && detail && !this.shell.onboarding.isOpen) {
          this.shell.toast(detail, 'success');
        }
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
    // Retry safety (audit CELLY-BUG-004): key off the tracker's real in-flight state, not a
    // one-way flag. `camera` leaves 'requesting' on every terminal state (denied / timeout /
    // error) and the tracker also refuses re-entry while `starting`, so a later "Try again"
    // always gets a fresh attempt instead of a permanent block.
    if (this.tracker.ready || this.tracker.isStarting()) return;
    this.cameraAttemptCount += 1;
    this.shell.controls.setCameraStatus('requesting');
    this.shell.onboarding.setCameraStatus('requesting');
    await this.tracker.start();
    this.shell.controls.setCameraStatus(this.tracker.camera, this.tracker.detail ?? undefined);
    this.shell.onboarding.setCameraStatus(this.tracker.camera, this.tracker.detail ?? undefined);
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
        this.fp.resetHandSides();
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
    if (key === 'showWebcam') {
      this.shell.toast(value ? this.t('previewOn') : this.t('previewOff'), value ? 'success' : 'warn');
    }
  }

  private toggleAutoRotate(): void {
    this.settings.autoRotate = !this.settings.autoRotate;
    this.applySettings();
    this.saveSettings();
  }

  /**
   * Clear Leitner boxes and quiz best scores (audit task 3.3). The confirmation dialog lives in
   * the control panel; this method is the single mutation point.
   */
  private resetProgress(): void {
    const page = this.pages.get('test') as TestingPage | undefined;
    page?.resetProgress();
    this.shell.toast(this.t('progressReset'), 'success');
  }

  private setLanguage(language: Language): void {
    this.settings.language = language;
    document.documentElement.lang = language;
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
    root.lang = this.settings.language;
    root.dataset.reducedMotion = String(this.settings.reducedMotion);
    root.dataset.highContrast = String(this.settings.highContrast);
    this.scene.setReducedMotion(this.settings.reducedMotion);
    for (const page of this.pages.values()) {
      page.setReducedMotion?.(this.settings.reducedMotion);
    }
    this.current?.setAutoRotate?.(this.settings.autoRotate);
  }

  private saveSettings(): void {
    saveJSON(SETTINGS_KEY, { ...this.settings, _version: SETTINGS_VERSION });
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
    next.setReducedMotion?.(this.settings.reducedMotion);
    next.setAutoRotate?.(this.settings.autoRotate);
    next.enter();
    this.fp.resetInteraction();
    this.shell.controls.preview.setVisible(this.settings.showWebcam);
    this.shell.refreshButtons();
  }

  // ------------------------------------------------------------------------ input

  private bindInput(): void {
    const canvas = this.scene.renderer.domElement;
    canvas.addEventListener('pointermove', (event: PointerEvent) => {
      if (this.fp.frames.length) return;
      this.mouseHover(event.clientX, event.clientY);
    });
    canvas.addEventListener('pointerleave', () => {
      if (this.fp.frames.length) return;
      this.shell.registry.setHover(null);
      this.current?.setHovered(null);
    });
    canvas.addEventListener('click', (event: MouseEvent) => {
      if (this.fp.frames.length) return;
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
      if (this.disposed || event.defaultPrevented) return;
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
        case 'd':
        case 'D':
          this.toggleDebugOverlay();
          break;
        case 't':
        case 'T':
          this.toggleSelectionTest();
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
      if (this.disposed) return;
      if (document.hidden) {
        cancelAnimationFrame(this.raf);
      } else {
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

  /**
   * Smoother timestep for the landmark filters. Detections now arrive asynchronously from the
   * tracking worker, so their spacing is the real pace of the signal, not the render clock.
   * Clamped to the range the one-euro filters are designed for.
   */
  private detectionDt(raw: RawFrame | null): number {
    if (!raw) return 1 / 30;
    const previous = this.lastDetectionMs;
    this.lastDetectionMs = raw.tMs;
    if (previous <= 0) return 1 / 30;
    return clamp((raw.tMs - previous) / 1000, 1 / 120, 0.2);
  }

  private tick(): void {
    if (this.replay.size) {
      this.fp.setFrames([...this.replay.values()]);
      this.fp.updateHover();
      this.dispatch(this.fp.stepGestures(performance.now()));
      this.fp.clearFinishedAimLocks();
      // One-shot edges, exactly like a real detection frame.
      for (const frame of this.fp.frames) {
        frame.pinchStart = false;
        frame.pinchEnd = false;
      }
      return;
    }

    // Inference runs in the tracking worker, so a detection is consumed here when it arrives
    // rather than produced here. No new result simply means the worker is still busy.
    const raw = this.tracker.poll();
    // Build frames every tick, result or not: with no tracker and no synthetic hands this is
    // an empty list, but it is also what ages the 250 ms tolerance out and lets the gesture
    // engine retire cursors, hints and hover when the hands leave the frame.
    this.fp.buildFrames(raw, this.detectionDt(raw), this.lastTickMs, {
      width: window.innerWidth,
      height: window.innerHeight
    });
    this.fp.updateHover();
    this.dispatch(this.fp.stepGestures(this.lastTickMs));
    this.fp.clearFinishedAimLocks();

    if (this.fp.gestureFrame && !this.settings.dwellClick) this.shell.registry.setDwell(null, 0);
    else if (this.fp.gestureFrame?.dwellProgress) {
      this.shell.registry.setDwell(this.fp.uiHover, this.fp.gestureFrame.dwellProgress);
    }
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
    const primary = primaryHand(this.fp.frames);
    const jitter = primary ? motionEnergy(this.previousJitter, primary.landmarks) : 0;
    if (primary) this.previousJitter = primary.landmarks.map((p) => ({ ...p }));
    this.quality = scoreQuality({
      hands: this.fp.frames.filter((f) => f.present).length,
      scores: this.fp.handScores,
      jitter,
      trackerFps: this.tracker.trackerFps,
      margin: frameMargin(this.fp.frames.map((f) => f.landmarks))
    });

    const left = this.fp.frames.find((f) => f.side === 'left');
    const right = this.fp.frames.find((f) => f.side === 'right');
    this.shell.updateHud({
      hands: this.fp.frames.filter((f) => f.present).length,
      sides: this.fp.frames.map((f) => f.side),
      pinchLeft: left?.pinchValue ?? 0,
      pinchRight: right?.pinchValue ?? 0,
      pinchingLeft: !!left?.pinching,
      pinchingRight: !!right?.pinching,
      landmarks: this.fp.frames.filter((f) => f.present).length * 21,
      quality: this.quality,
      tracking: this.tracker.ready,
      trackerFps: this.tracker.trackerFps,
      renderFps: this.renderFps,
      mirrorX: this.settings.mirrorX,
      mirrorY: this.settings.mirrorY,
      swap: this.settings.handsSwap,
      gesture: this.fp.gestureFrame?.state ?? 'IDLE',
      hint: this.gestureHint()
    });
  }

  /** Gesture hint for display, translated when the interface is French. */
  private gestureHint(): string {
    const frame = this.fp.gestureFrame;
    if (!frame) return '';
    return this.settings.language === 'fr' ? GESTURE_HINTS_FR[frame.state] || frame.hint : frame.hint;
  }

  private updateCursors(): void {
    const cursors =
      this.fp.gestureFrame?.cursors ??
      this.fp.frames
        .filter((f) => f.present)
        .map((f) => ({
          side: f.side,
          x: f.cursor.x,
          y: f.cursor.y,
          visible: true,
          active: f.side === primaryHand(this.fp.frames)?.side,
          pinchValue: f.pinchValue,
          mode: (f.pinching ? 'pinch' : 'pointer') as 'pinch' | 'pointer' | 'passive'
        }));
    this.shell.cursors.update(
      cursors,
      this.gestureHint(),
      this.fp.uiHover ? (this.fp.gestureFrame?.dwellProgress ?? 0) : 0,
      this.fp.hoverLabel,
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
    if (!this.reducedMotion) this.motionElapsed += dt;

    this.renderFrames += 1;
    this.framesRendered += 1;
    this.renderClock += dt;
    if (this.renderClock >= 0.5) {
      this.renderFps = Math.round(this.renderFrames / this.renderClock);
      this.renderFrames = 0;
      this.renderClock = 0;
    }

    this.tick();
    this.hands.update(
      this.fp.frames,
      this.settings,
      dt,
      this.scene.camera,
      this.scene.renderer.getPixelRatio()
    );
    this.current?.update(dt, this.motionElapsed);
    this.shell.controls.preview.draw(this.fp.frames, this.settings);
    this.shell.onboarding.drawPreview(this.fp.frames, this.settings);
    this.updateCursors();
    this.updateHud(now);
    this.updateDebugOverlay();
    this.scene.render(dt);
  };

  start(): void {
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ test hooks

  /** Toggle the on-screen hand-selection debug view (D key or HUD button). */
  toggleDebugOverlay(force?: boolean): boolean {
    this.debugVisible = this.debug.toggle(force);
    if (this.debugVisible) this.updateDebugOverlay();
    return this.debugVisible;
  }

  get debugOverlayVisible(): boolean {
    return this.debugVisible;
  }

  /** Monotonic render-loop counter for screenshot specs that must wait for real frames. */
  get renderedFrames(): number {
    return this.framesRendered;
  }

  /**
   * Camera + worker tracking health, for diagnostics and the browser-level tests that prove
   * inference really runs off the main thread.
   */
  trackingState(): {
    camera: CameraStatus;
    tracking: TrackingStatus;
    detail: string | null;
    trackerFps: number;
    inferenceMs: number;
    ready: boolean;
  } {
    return {
      camera: this.tracker.camera,
      tracking: this.tracker.tracking,
      detail: this.tracker.detail,
      trackerFps: this.tracker.trackerFps,
      inferenceMs: this.tracker.inferenceMs,
      ready: this.tracker.ready
    };
  }

  /** cameraAttempts() — how many real camera requests this session has issued (retry tests). */
  get cameraAttempts(): number {
    return this.cameraAttemptCount;
  }

  /** Start/stop the built-in Selection test on the interactive lab page (T key or HUD). */
  toggleSelectionTest(): void {
    if (this.current?.id !== 'interactive') this.setPage('interactive');
    const page = this.pages.get('interactive') as InteractiveLabPage | undefined;
    page?.toggleSelectionTest();
  }

  selectionTestState(): Record<string, unknown> {
    const page = this.pages.get('interactive') as InteractiveLabPage | undefined;
    return page?.selectionTestState() ?? { active: false };
  }

  /** Pinch-start halo pulse state, for the feedback E2E (null when no pulse is playing). */
  selectionFlashState(): { id: string; remainingMs: number } | null {
    const page = this.pages.get('interactive') as InteractiveLabPage | undefined;
    return page?.selectionFlashState() ?? null;
  }

  /** Knowledge-graph label boxes from the last layout pass, for the collision E2E. */
  knowledgeLabels(): ReturnType<KnowledgePage['labelDebug']> {
    const page = this.pages.get('knowledge') as KnowledgePage | undefined;
    return page?.labelDebug() ?? [];
  }

  private updateDebugOverlay(): void {
    if (!this.debugVisible) return;
    const primary = primaryHand(this.fp.frames);
    this.debug.update({
      page: this.current?.id ?? null,
      frames: this.fp.frames,
      primary,
      pickRadius: this.fp.pickRadius,
      armed: this.fp.sceneHover,
      uiHover: this.fp.uiHover,
      pinchLog: this.fp.pinchLog,
      rig: primary ? this.hands.debugHand(primary.side) : null
    });
  }

  /**
   * Injects a synthetic hand so screenshots and e2e specs can drive the whole pipeline
   * (hover → gesture engine → intents) without a physical camera or a video file.
   * Coordinates are CSS pixels relative to the viewport.
   */
  injectHand(side: HandSide, x: number, y: number, pinch = 0, present = true): void {
    if (!present) {
      this.replay.delete(side);
      this.replayPinch.delete(side);
      this.fp.clearAimLock(side);
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
    const start = pinching && !wasPinching;
    const end = !pinching && wasPinching;
    this.replayPinch.set(side, pinching);
    const t = performance.now();
    const cursor: Vec2 = { x, y };
    const aimState = this.fp.trackAim(side, cursor, t, {
      start,
      pinching,
      end,
      anchorAt: t - DEFAULT_PINCH.minHoldMs
    });
    const aimLocked = aimState.aimLocked;
    const aimPoint = aimState.aim;
    const wristScreen = mapNormalized(synthetic.landmarks[0], {
      width: w,
      height: h,
      mirrorX: this.settings.mirrorX,
      mirrorY: this.settings.mirrorY
    });
    const mcpScreen = mapNormalized(synthetic.landmarks[9], {
      width: w,
      height: h,
      mirrorX: this.settings.mirrorX,
      mirrorY: this.settings.mirrorY
    });
    const handSpan = Math.hypot(mcpScreen.x - wristScreen.x, mcpScreen.y - wristScreen.y) / h;

    this.replay.set(side, {
      side,
      present: true,
      pinching,
      pinchValue: pinch,
      pinchStart: start,
      pinchEnd: end,
      cursor,
      pinchPoint: pinchContact(synthetic.landmarks, {
        width: w,
        height: h,
        mirrorX: this.settings.mirrorX,
        mirrorY: this.settings.mirrorY
      }),
      rawCursor: { ...cursor },
      aim: { x: aimPoint.x, y: aimPoint.y },
      aimLocked,
      cursorNdc: { x: (x / w) * 2 - 1, y: -((y / h) * 2 - 1) },
      palm: synthetic.palm,
      landmarks: synthetic.landmarks,
      world: synthetic.world,
      handScale: synthetic.handScale,
      handSpan,
      confidence: 1,
      pinchCandidateAt: aimState.lockAt,
      wrist: synthetic.landmarks[0],
      roll: synthetic.roll,
      tMs: t
    });
  }

  clearInjectedHands(): void {
    this.replay.clear();
    this.replayPinch.clear();
  }

  /** Build a deterministic pose without injecting it (used to write replay fixtures). */
  makePose(name: PoseName, side: HandSide, x: number, y: number, phase = 0): PoseData {
    return buildPose(
      name,
      side,
      x,
      y,
      { width: window.innerWidth, height: window.innerHeight },
      { mirrorX: this.settings.mirrorX, mirrorY: this.settings.mirrorY },
      phase
    );
  }

  poseSequence(name: PoseName, side: HandSide, x: number, y: number): PoseData[] {
    return buildPoseSequence(
      name,
      side,
      x,
      y,
      { width: window.innerWidth, height: window.innerHeight },
      { mirrorX: this.settings.mirrorX, mirrorY: this.settings.mirrorY }
    );
  }

  injectPose(name: PoseName, side: HandSide, x: number, y: number, phase = 0): PoseData {
    const data = this.makePose(name, side, x, y, phase);
    this.injectPoseData(data);
    return data;
  }

  /** Replay one recorded landmark frame (tests/fixtures/hand-poses/*.json). */
  injectPoseData(data: PoseData): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pinching = data.pinching;
    const wasPinching = this.replayPinch.get(data.side) ?? false;
    const start = pinching && !wasPinching;
    const end = !pinching && wasPinching;
    this.replayPinch.set(data.side, pinching);
    const t = performance.now();
    const cursor: Vec2 = { x: data.cursor.x, y: data.cursor.y };
    const aimState = this.fp.trackAim(data.side, cursor, t, {
      start,
      pinching,
      end,
      anchorAt: t - DEFAULT_PINCH.minHoldMs
    });
    const aimLocked = aimState.aimLocked;
    const aimPoint = aimState.aim;

    this.replay.set(data.side, {
      side: data.side,
      present: true,
      pinching,
      pinchValue: data.pinch,
      pinchStart: start,
      pinchEnd: end,
      cursor,
      pinchPoint: pinchContact(data.landmarks, {
        width: w,
        height: h,
        mirrorX: this.settings.mirrorX,
        mirrorY: this.settings.mirrorY
      }),
      rawCursor: { ...cursor },
      aim: { x: aimPoint.x, y: aimPoint.y },
      aimLocked,
      cursorNdc: toNDC(cursor, { width: w, height: h, mirrorX: false, mirrorY: false }),
      palm: data.palm,
      landmarks: data.landmarks,
      world: data.world,
      handScale: Math.max(0.03, dist3(data.world[0], data.world[9])),
      handSpan: data.handSpan,
      confidence: 1,
      pinchCandidateAt: aimState.lockAt,
      wrist: data.landmarks[0],
      roll: data.roll,
      tMs: t
    });
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
      hands: this.fp.frames.length,
      uiHover: this.fp.uiHover,
      sceneHover: this.fp.sceneHover
    };
  }

  /** Draw-call and resolution snapshot used by the performance audit. */
  get renderStats(): SceneManager['renderStats'] {
    return this.scene.renderStats;
  }

  /** Reduce-motion snapshot for the accessibility E2E (rig rotation, dust clock, camera tween). */
  motionState(): {
    reducedMotion: boolean;
    rigRotationY: number;
    dustClock: number;
    transitioning: boolean;
  } {
    const lab = this.pages.get('interactive') as InteractiveLabPage | undefined;
    return {
      reducedMotion: this.reducedMotion,
      rigRotationY: lab?.rigRotationY ?? 0,
      dustClock: this.scene.dustClock,
      transitioning: this.scene.isTransitioning
    };
  }

  /** Test hook: where the pipeline thinks the cursor is versus where the 3D hand sits. */
  debugHand(side: HandSide): Record<string, unknown> {
    const frame = this.fp.frames.find((f) => f.side === side && f.present);
    const container = this.hands.debugContainer(side);
    if (!frame || !container) return { side, present: false };
    const map = {
      width: window.innerWidth,
      height: window.innerHeight,
      mirrorX: this.settings.mirrorX,
      mirrorY: this.settings.mirrorY
    };
    const mapped = mapNormalized(frame.landmarks[0], map);
    const landmarkIndex = mapNormalized(frame.landmarks[8], map);
    const landmarkThumb = mapNormalized(frame.landmarks[4], map);
    const p = container.position;
    const projected = this.scene.projectToScreen(p);
    const offsetPx = Math.hypot(projected.x - mapped.x, projected.y - mapped.y);
    const pinch = this.hands.debugPinch(side, this.scene.camera);
    const pinchOffsetPx = pinch
      ? Math.hypot(pinch.x - frame.pinchPoint.x, pinch.y - frame.pinchPoint.y)
      : null;
    const indexTip = this.hands.debugLandmark(side, this.scene.camera, 8);
    const skeletonIndexOffsetPx = indexTip
      ? Math.hypot(indexTip.x - frame.cursor.x, indexTip.y - frame.cursor.y)
      : null;
    const rig = this.hands.debugHand(side);
    return {
      side,
      present: true,
      cursor: [Math.round(frame.cursor.x), Math.round(frame.cursor.y)],
      rawCursor: [Math.round(frame.rawCursor.x), Math.round(frame.rawCursor.y)],
      aim: [Math.round(frame.aim.x), Math.round(frame.aim.y)],
      aimLocked: frame.aimLocked,
      wristScreen: [Math.round(mapped.x), Math.round(mapped.y)],
      landmarkIndexTip: [Number(landmarkIndex.x.toFixed(1)), Number(landmarkIndex.y.toFixed(1))],
      landmarkThumbTip: [Number(landmarkThumb.x.toFixed(1)), Number(landmarkThumb.y.toFixed(1))],
      containerScreen: [Math.round(projected.x), Math.round(projected.y)],
      offsetPx: Number(offsetPx.toFixed(2)),
      offsetPctHeight: Number(((offsetPx / window.innerHeight) * 100).toFixed(2)),
      skeletonPinch: pinch
        ? [Number(pinch.x.toFixed(1)), Number(pinch.y.toFixed(1))]
        : null,
      skeletonPinchOffsetPx: pinchOffsetPx === null ? null : Number(pinchOffsetPx.toFixed(2)),
      skeletonIndexTip: indexTip
        ? [Number(indexTip.x.toFixed(1)), Number(indexTip.y.toFixed(1))]
        : null,
      skeletonIndexOffsetPx:
        skeletonIndexOffsetPx === null ? null : Number(skeletonIndexOffsetPx.toFixed(2)),
      skeletonPoints: rig?.points ?? null,
      skeletonSegments: rig?.segments ?? null,
      skeletonSource: rig?.source ?? null,
      pickRadius: Number(this.fp.pickRadius.toFixed(1)),
      container: [Number(p.x.toFixed(3)), Number(p.y.toFixed(3)), Number(p.z.toFixed(3))],
      scale: Number(container.scale.x.toFixed(3)),
      rig
    };
  }

  private t(key: keyof typeof APP_STRINGS.en): string {
    return APP_STRINGS[this.settings.language][key];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    void this.tracker.stop();
    this.hands.dispose();
    for (const page of this.pages.values()) page.dispose();
    this.scene.dispose();
    this.debug.root.remove();
    this.shell.destroy();
  }
}

function primaryHand(frames: HandFrame[]): HandFrame | null {
  return frames.find((f) => f.present && f.side === 'right') ?? frames.find((f) => f.present) ?? null;
}

function isCameraError(status: string): boolean {
  return (
    status === 'denied' ||
    status === 'not-found' ||
    status === 'in-use' ||
    status === 'insecure-context' ||
    status === 'unsupported' ||
    status === 'timeout'
  );
}

/**
 * Persisted settings are sanitized, not trusted: every field is type-checked against the
 * current schema and unknown keys never merge in (audit CELLY-BUG-002). The stored payload
 * carries a `_version` stamp so a future schema change can discard stale shapes wholesale.
 */
function loadSettings(): Settings {
  return sanitizeSettings(loadJSON<unknown>(SETTINGS_KEY, {}));
}
