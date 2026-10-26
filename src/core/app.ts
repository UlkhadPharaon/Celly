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
  Vec2,
  Vec3
} from '../types';
import type { OrganelleId } from '../scene/types';
import { SceneManager } from '../scene/sceneManager';
import { HandTracker } from '../tracking/handTracker';
import { HandSideResolver } from '../tracking/handSide';
import { LandmarkFilterBank, motionEnergy } from '../tracking/landmarkFilter';
import { frameMargin, scoreQuality } from '../tracking/quality';
import { DEFAULT_PINCH, PINCH_SENSITIVITY, initialPinch, isFist, pinchValue, updatePinch, type PinchState } from '../gestures/pinch';
import { handRoll, mapNormalized, palmPoint, pinchCursor, toNDC, unreach } from '../gestures/cursor';
import { GestureEngine } from '../gestures/gestureEngine';
import { AimTracker } from '../gestures/aim';
import { HandLayer } from '../scene/handLayer';
import { DebugOverlay } from '../ui/debugOverlay';
import { Shell } from '../ui/shell';
import type { ControlState, ToggleKey } from '../ui/controlPanel';
import { loadJSON, saveJSON } from './store';
import { preferredQuality } from './device';
import { synthHand } from './replayHand';
import { buildPose, buildPoseSequence, type PoseData, type PoseName } from './handPoses';
import { clamp, dist3 } from './math';
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
  proceduralHand: false,
  quality: preferredQuality()
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
  private readonly aim = new AimTracker();
  private readonly aimLocks = new Map<HandSide, { point: Vec2; source: string; at: number }>();
  private readonly debug = new DebugOverlay();

  private frames: HandFrame[] = [];
  private gestureFrame: GestureFrame | null = null;
  private current: Page | null = null;
  private uiHover: string | null = null;
  private sceneHover: string | null = null;
  private hoverLabel = '';
  private cameraRequested = false;
  private sticky: { id: string; at: number; x: number; y: number } | null = null;
  private pickRadius = 52;
  private debugVisible = false;

  private quality: TrackingQuality = { level: 'none', value: 0, jitter: 0, margin: 0 };
  private previousJitter: Vec3[] | null = null;
  private lastHudAt = 0;
  private lastTime = 0;
  private lastTickMs = 0;
  private elapsed = 0;
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
      onOnboardingComplete: (requested) => {
        saveJSON(ONBOARD_KEY, true);
        if (!requested && !this.tracker.ready) this.shell.toast(this.t('mouseMode'), 'info');
      },
      onOverlayClose: () => this.current?.closeOverlay()
    });
    mount.append(this.shell.root);
    document.body.append(this.debug.root);
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
    void this.hands.init(this.settings.proceduralHand);
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
      case 'proceduralHand':
        this.settings.proceduralHand = value;
        void this.reloadHands();
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

  private async reloadHands(): Promise<void> {
    this.hands.dispose();
    await this.hands.init(this.settings.proceduralHand);
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
      highContrast: this.settings.highContrast,
      proceduralHand: this.settings.proceduralHand
    };
  }

  private applySettings(): void {
    this.shell.setControlState(this.controlState());
    this.reducedMotion = this.settings.reducedMotion;
    const root = document.documentElement;
    root.lang = this.settings.language;
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
      const rawCursor = pinchCursor(hand.landmarks, map).cursor;
      const wristScreen = mapNormalized(norm[0], map);
      const mcpScreen = mapNormalized(norm[9], map);
      const handSpan =
        Math.hypot(mcpScreen.x - wristScreen.x, mcpScreen.y - wristScreen.y) /
        Math.max(1, map.height);

      // The selection anchor is sampled before the fingertips converge. It is frozen while the
      // pinch is in flight so the cursor does not slide off the organelle between start/release.
      this.aim.push(side, t, cursor);
      const candidateAt = update.state.candidateSince;
      let lock = this.aimLocks.get(side);
      if (update.start) {
        const anchor = this.aim.aimFor(side, candidateAt >= 0 ? candidateAt : t);
        lock = { point: anchor.point, source: anchor.source, at: t };
        this.aimLocks.set(side, lock);
      } else if (update.state.active && !lock) {
        lock = { point: { ...cursor }, source: 'live', at: t };
        this.aimLocks.set(side, lock);
      }
      const aimLocked = !!lock && (update.start || update.state.active || update.end);
      const aimPoint = aimLocked && lock ? lock.point : cursor;

      const frame: HandFrame = {
        side,
        present: true,
        pinching: update.state.active,
        pinchValue: value,
        pinchStart: update.start,
        pinchEnd: update.end,
        cursor,
        rawCursor,
        aim: { x: aimPoint.x, y: aimPoint.y },
        aimLocked,
        cursorNdc: ndc,
        palm: palmPoint(norm, map),
        landmarks: norm,
        world,
        handScale: Math.max(0.03, dist3(world[0], world[9])),
        handSpan,
        confidence: hand.score,
        pinchCandidateAt: candidateAt,
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
          pinchEnd: last.pinching,
          lost: true,
          confidence: 0,
          pinchCandidateAt: -1,
          aimLocked: false,
          aim: { ...last.cursor },
          rawCursor: { ...last.rawCursor }
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
      this.clearFinishedAimLocks();
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
    this.clearFinishedAimLocks();

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

  private clearFinishedAimLocks(): void {
    for (const frame of this.frames) {
      if (frame.pinchEnd || frame.lost || (!frame.pinching && !frame.pinchStart)) {
        this.aimLocks.delete(frame.side);
      }
    }
  }

  private updateHover(): void {
    const primary = primaryHand(this.frames);
    if (!primary) {
      this.uiHover = null;
      this.sceneHover = null;
      this.hoverLabel = '';
      this.sticky = null;
      this.current?.setHovered(null);
      this.shell.registry.setHover(null);
      return;
    }

    this.pickRadius = clamp(52 * (0.1 / Math.max(0.04, primary.handSpan)), 40, 62);
    const aim = primary.aim;
    this.uiHover = this.shell.registry.hitTest(aim.x, aim.y);
    if (primary.pinching) {
      // Freeze the armed scene target for the duration of the pinch. The pre-pinch aim lock is
      // deliberately 100 ms old, so re-picking from it mid-gesture could silently move the target
      // to a neighbour (or to blank) after the user already committed. The gesture engine captured
      // this target on pinch start and will select it on release.
      this.shell.registry.setHover(this.uiHover);
      return;
    }
    if (this.uiHover) {
      this.sticky = null;
      this.sceneHover = null;
    } else {
      const now = performance.now();
      const picked = this.current?.pick(aim.x, aim.y, { radiusPx: this.pickRadius }) ?? null;
      if (picked) {
        // Hysteresis: once a target is armed, a few pixels of landmark jitter must not switch to
        // an overlapping neighbour. Deliberate movement (>20 px) still re-aims immediately.
        const hold =
          this.sticky &&
          this.sticky.id !== picked &&
          now - this.sticky.at <= 220 &&
          Math.hypot(aim.x - this.sticky.x, aim.y - this.sticky.y) <= 20;
        if (hold) {
          this.sceneHover = this.sticky!.id;
        } else {
          this.sceneHover = picked;
          this.sticky = { id: picked, at: now, x: aim.x, y: aim.y };
        }
      } else if (
        this.sticky &&
        now - this.sticky.at <= 220 &&
        Math.hypot(aim.x - this.sticky.x, aim.y - this.sticky.y) <= 96
      ) {
        // Sticky armed hover: a few pixels of landmark jitter immediately after aiming must not
        // turn a target into blank space.
        this.sceneHover = this.sticky.id;
      } else {
        this.sceneHover = null;
        this.sticky = null;
      }
    }
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
    this.framesRendered += 1;
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
    this.updateDebugOverlay();
    this.scene.render(this.reducedMotion ? dt * 0.35 : dt);
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

  private updateDebugOverlay(): void {
    if (!this.debugVisible) return;
    const primary = primaryHand(this.frames);
    this.debug.update({
      page: this.current?.id ?? null,
      frames: this.frames,
      primary,
      pickRadius: this.pickRadius,
      armed: this.sceneHover,
      uiHover: this.uiHover,
      pinchLog: this.engine.getPinchLog(),
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
      this.aimLocks.delete(side);
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
    this.aim.push(side, t, cursor);

    let lock = this.aimLocks.get(side);
    if (start) {
      const anchor = this.aim.aimFor(side, t - DEFAULT_PINCH.minHoldMs);
      lock = { point: anchor.point, source: anchor.source, at: t - DEFAULT_PINCH.minHoldMs };
      this.aimLocks.set(side, lock);
    } else if (pinching && !lock) {
      lock = { point: { ...cursor }, source: 'live', at: t };
      this.aimLocks.set(side, lock);
    }
    const aimLocked = !!lock && (start || pinching || end);
    const aimPoint = aimLocked && lock ? lock.point : cursor;
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
      pinchCandidateAt: lock?.at ?? -1,
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
    this.aim.push(data.side, t, cursor);

    let lock = this.aimLocks.get(data.side);
    if (start) {
      const anchor = this.aim.aimFor(data.side, t - DEFAULT_PINCH.minHoldMs);
      lock = { point: anchor.point, source: anchor.source, at: t - DEFAULT_PINCH.minHoldMs };
      this.aimLocks.set(data.side, lock);
    } else if (pinching && !lock) {
      lock = { point: { ...cursor }, source: 'live', at: t };
      this.aimLocks.set(data.side, lock);
    }
    const aimLocked = !!lock && (start || pinching || end);
    const aimPoint = aimLocked && lock ? lock.point : cursor;

    this.replay.set(data.side, {
      side: data.side,
      present: true,
      pinching,
      pinchValue: data.pinch,
      pinchStart: start,
      pinchEnd: end,
      cursor,
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
      pinchCandidateAt: lock?.at ?? -1,
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
      hands: this.frames.length,
      uiHover: this.uiHover,
      sceneHover: this.sceneHover
    };
  }

  /** Draw-call and resolution snapshot used by the performance audit. */
  get renderStats(): SceneManager['renderStats'] {
    return this.scene.renderStats;
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
    const projected = this.scene.projectToScreen(p);
    const offsetPx = Math.hypot(projected.x - mapped.x, projected.y - mapped.y);
    return {
      side,
      present: true,
      cursor: [Math.round(frame.cursor.x), Math.round(frame.cursor.y)],
      rawCursor: [Math.round(frame.rawCursor.x), Math.round(frame.rawCursor.y)],
      aim: [Math.round(frame.aim.x), Math.round(frame.aim.y)],
      aimLocked: frame.aimLocked,
      wristScreen: [Math.round(mapped.x), Math.round(mapped.y)],
      containerScreen: [Math.round(projected.x), Math.round(projected.y)],
      offsetPx: Number(offsetPx.toFixed(2)),
      offsetPctHeight: Number(((offsetPx / window.innerHeight) * 100).toFixed(2)),
      container: [Number(p.x.toFixed(3)), Number(p.y.toFixed(3)), Number(p.z.toFixed(3))],
      scale: Number(container.scale.x.toFixed(3)),
      rig: this.hands.debugHand(side)
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
    this.debug.root.remove();
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
  if (merged.quality !== 'low' && merged.quality !== 'high') merged.quality = preferredQuality();
  if (!Number.isFinite(merged.pinchSensitivity)) merged.pinchSensitivity = PINCH_SENSITIVITY.normal;
  merged.pinchSensitivity = Math.min(
    PINCH_SENSITIVITY.max,
    Math.max(PINCH_SENSITIVITY.min, merged.pinchSensitivity)
  );
  return merged;
}
