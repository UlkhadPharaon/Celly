import type { Language, PageId, QualityMode, Settings } from '../types';
import { ButtonRegistry } from './buttons';
import { ControlPanel, type ControlState, type ToggleKey } from './controlPanel';
import { CursorLayer } from './cursorLayer';
import { Hud, type HudState } from './hud';
import { Onboarding } from './onboarding';
import { Overlay } from './overlay';
import { Tabs } from './tabs';
import { ICONS, svgIcon } from './dom';

export interface ShellHandlers {
  onPage: (page: PageId) => void;
  onToggle: (key: ToggleKey, value: boolean) => void;
  onLanguage: (lang: Language) => void;
  onQuality: (q: QualityMode) => void;
  onPinchSensitivity: (value: number) => void;
  onHelp: () => void;
  onRetryCamera: () => void;
  onAutoRotate: () => void;
  onEnableCamera: () => void;
  onOnboardingComplete: (cameraRequested: boolean) => void;
  onOverlayClose: () => void;
}

const LEGEND = {
  en: [
    { icon: ICONS.hand, label: 'Pinch a part', action: 'Select', tone: 'cyan' },
    { icon: ICONS.close, label: 'Pinch the void', action: 'Back', tone: 'slate' },
    { icon: ICONS.rotate, label: 'Left pinch + drag', action: 'Rotate', tone: 'violet' },
    { icon: ICONS.scale, label: 'Both hands pinch', action: 'Scale', tone: 'amber' },
    { icon: ICONS.flip, label: 'Pinch + drag', action: 'Swipe', tone: 'slate' }
  ],
  fr: [
    { icon: ICONS.hand, label: 'Pincer un élément', action: 'Sélectionner', tone: 'cyan' },
    { icon: ICONS.close, label: 'Pincer le vide', action: 'Retour', tone: 'slate' },
    { icon: ICONS.rotate, label: 'Pincement gauche + glisser', action: 'Tourner', tone: 'violet' },
    { icon: ICONS.scale, label: 'Pincer des deux mains', action: 'Échelle', tone: 'amber' },
    { icon: ICONS.flip, label: 'Pincer + glisser', action: 'Balayer', tone: 'slate' }
  ]
};

const UI_COPY = {
  en: { autoRotate: 'Auto-rotate', stop: 'Stop', help: 'Help', gestures: 'Gestures', status: 'ON-DEVICE · MEDIAPIPE' },
  fr: { autoRotate: 'Rotation auto', stop: 'Arrêter', help: 'Aide', gestures: 'Gestes', status: 'LOCAL · MEDIAPIPE' }
};

export class Shell {
  readonly root: HTMLElement;
  readonly registry = new ButtonRegistry();
  readonly hud: Hud;
  readonly controls: ControlPanel;
  readonly tabs: Tabs;
  readonly overlay: Overlay;
  readonly cursors: CursorLayer;
  readonly onboarding: Onboarding;
  readonly pageLayer: HTMLElement;

  private readonly autoButton: HTMLButtonElement;
  private readonly autoLabel: HTMLElement;
  private readonly legendRoot: HTMLElement;
  private readonly toastHost: HTMLElement;
  private readonly onResize = (): void => this.syncLegend();
  private language: Language;
  private autoRotate = true;

  constructor(settings: Settings, private readonly handlers: ShellHandlers) {
    this.language = settings.language;
    this.autoRotate = settings.autoRotate;

    this.root = document.createElement('div');
    this.root.className = 'app';
    this.root.dataset.language = settings.language;

    const stage = document.createElement('div');
    stage.className = 'stage';
    stage.id = 'stage';
    this.root.append(stage);

    const grain = document.createElement('div');
    grain.className = 'grain';
    this.root.append(grain);
    const vignette = document.createElement('div');
    vignette.className = 'vignette';
    this.root.append(vignette);

    // ---------------------------------------------------------------- top bar
    const topbar = document.createElement('header');
    topbar.className = 'topbar';

    const brand = document.createElement('div');
    brand.className = 'brand';
    brand.innerHTML = `
      <span class="brand-mark"><i></i><i></i><b></b></span>
      <span class="brand-word">CELLY</span>
      <span class="brand-version">v0.2</span>
    `;
    topbar.append(brand);

    this.tabs = new Tabs(this.registry, handlers.onPage, settings.language);
    topbar.append(this.tabs.root);

    const actions = document.createElement('div');
    actions.className = 'top-actions';

    this.autoButton = document.createElement('button');
    this.autoButton.className = 'auto-rotate';
    this.autoButton.type = 'button';
    this.autoButton.dataset.on = String(this.autoRotate);
    this.autoButton.innerHTML = `<span class="auto-glyph"></span><span class="auto-label"></span>`;
    this.autoButton.addEventListener('click', handlers.onAutoRotate);
    this.registry.register('top:auto-rotate', this.autoButton, handlers.onAutoRotate);
    this.autoLabel = this.autoButton.querySelector('.auto-label') as HTMLElement;
    actions.append(this.autoButton);

    const help = document.createElement('button');
    help.className = 'icon-btn top-help';
    help.type = 'button';
    help.append(svgIcon(ICONS.help));
    help.addEventListener('click', handlers.onHelp);
    this.registry.register('top:help', help, handlers.onHelp);
    actions.append(help);
    topbar.append(actions);
    this.root.append(topbar);

    // -------------------------------------------------------------------- HUD
    // HUD and gesture legend share one left rail. They used to be two independently positioned
    // blocks, which collided as soon as the HUD grew or the viewport got shorter than ~900 px.
    const rail = document.createElement('div');
    rail.className = 'left-rail';
    this.root.append(rail);

    this.hud = new Hud(settings.language);
    rail.append(this.hud.root);

    // ----------------------------------------------------------------- legend
    this.legendRoot = document.createElement('aside');
    this.legendRoot.className = 'legend glass';
    rail.append(this.legendRoot);
    this.renderLegend();
    this.syncLegend();
    window.addEventListener('resize', this.onResize);

    // --------------------------------------------------------------- controls
    const controlState: ControlState = {
      showWebcam: settings.showWebcam,
      showFeedback: settings.showFeedback,
      mirrorX: settings.mirrorX,
      mirrorY: settings.mirrorY,
      swap: settings.handsSwap,
      dwell: settings.dwellClick,
      autoRotate: settings.autoRotate,
      pinchSensitivity: settings.pinchSensitivity,
      language: settings.language,
      quality: settings.quality,
      reducedMotion: settings.reducedMotion,
      highContrast: settings.highContrast,
      proceduralHand: settings.proceduralHand
    };
    this.controls = new ControlPanel(
      this.registry,
      controlState,
      handlers.onToggle,
      handlers.onLanguage,
      handlers.onQuality,
      handlers.onPinchSensitivity,
      handlers.onHelp,
      handlers.onRetryCamera
    );
    this.root.append(this.controls.root);

    // -------------------------------------------------------------------- pages
    this.pageLayer = document.createElement('main');
    this.pageLayer.className = 'page-layer';
    this.root.append(this.pageLayer);

    // ------------------------------------------------------------------ overlay
    this.overlay = new Overlay(this.registry, () => this.handlers.onOverlayClose());
    this.root.append(this.overlay.root);

    this.cursors = new CursorLayer();
    this.root.append(this.cursors.root);

    this.toastHost = document.createElement('div');
    this.toastHost.className = 'toast-host';
    this.root.append(this.toastHost);

    this.onboarding = new Onboarding(this.registry, {
      onEnableCamera: handlers.onEnableCamera,
      onComplete: handlers.onOnboardingComplete
    });
    this.root.append(this.onboarding.root);

    this.syncAutoRotate();
  }

  setPage(page: PageId): void {
    this.tabs.setActive(page);
    this.root.dataset.page = page;
    this.overlay.hide();
    this.syncLegend();
    requestAnimationFrame(() => this.registry.refreshAll());
  }

  setAutoRotate(value: boolean): void {
    this.autoRotate = value;
    this.syncAutoRotate();
  }

  private syncAutoRotate(): void {
    const copy = UI_COPY[this.language];
    this.autoButton.dataset.on = String(this.autoRotate);
    this.autoLabel.textContent = this.autoRotate ? copy.stop : copy.autoRotate;
    this.autoButton.setAttribute('aria-pressed', String(this.autoRotate));
    this.autoButton.setAttribute('aria-label', this.autoRotate ? copy.stop : copy.autoRotate);
  }

  setLanguage(language: Language): void {
    this.language = language;
    this.root.dataset.language = language;
    this.hud.setLanguage(language);
    this.controls.setLanguage(language);
    this.tabs.setLanguage(language);
    this.onboarding.setLanguage(language);
    this.syncAutoRotate();
    this.renderLegend();
  }

  private renderLegend(): void {
    const copy = UI_COPY[this.language];
    const rows = LEGEND[this.language];
    this.legendRoot.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'legend-head';
    head.innerHTML = `<span class="eyebrow">${copy.gestures}</span>`;

    const body = document.createElement('div');
    body.className = 'legend-body';
    for (const row of rows) {
      const item = document.createElement('div');
      item.className = 'legend-row';
      item.dataset.tone = row.tone;
      const icon = svgIcon(row.icon);
      const text = document.createElement('div');
      text.innerHTML = `<span>${row.label}</span><b>${row.action}</b>`;
      item.append(icon, text);
      body.append(item);
    }
    const foot = document.createElement('div');
    foot.className = 'legend-foot';
    foot.textContent = copy.status;
    body.append(foot);

    this.legendRoot.append(head, body);
  }

  /**
   * The left rail has a fixed budget: HUD first, legend second. On short viewports and on the
   * Test page — where the question cards need the width — the legend collapses to its header
   * instead of colliding with the HUD or sitting on top of the cards.
   */
  private syncLegend(): void {
    const compact = window.innerHeight < 860 || this.root.dataset.page === 'test';
    this.legendRoot.classList.toggle('is-collapsed', compact);
  }

  setControlState(state: ControlState): void {
    this.controls.setState(state);
    this.setAutoRotate(state.autoRotate);
  }

  updateHud(state: HudState): void {
    this.hud.update(state);
    // The hands check is live: it must show the tracker's count, not just the initial zero.
    this.onboarding.setHands(state.hands);
  }

  toast(message: string, tone: 'info' | 'success' | 'warn' = 'info'): void {
    const node = document.createElement('div');
    node.className = 'toast';
    node.dataset.tone = tone;
    node.textContent = message;
    this.toastHost.append(node);
    requestAnimationFrame(() => node.classList.add('is-visible'));
    window.setTimeout(() => {
      node.classList.remove('is-visible');
      window.setTimeout(() => node.remove(), 420);
    }, 3200);
  }

  /** Recompute every gesture-button rect (call after route or layout changes). */
  refreshButtons(): void {
    this.registry.refreshAll();
  }

  showHelp(): void {
    this.onboarding.open();
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.registry.clear();
    this.overlay.destroy();
    this.cursors.destroy();
    this.root.remove();
  }
}
