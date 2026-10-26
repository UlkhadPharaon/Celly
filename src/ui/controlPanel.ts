import type { CameraStatus, Language, QualityMode } from '../types';
import type { ButtonRegistry } from './buttons';
import { svgIcon, ICONS } from './dom';
import { WebcamPreview } from './webcamPreview';
import { PINCH_SENSITIVITY } from '../gestures/pinch';
import { createProjectLink, registerProjectLink, updateProjectLink } from './projectLinks';

export interface ControlState {
  showWebcam: boolean;
  showFeedback: boolean;
  mirrorX: boolean;
  mirrorY: boolean;
  swap: boolean;
  dwell: boolean;
  autoRotate: boolean;
  pinchSensitivity: number;
  language: Language;
  quality: QualityMode;
  reducedMotion: boolean;
  highContrast: boolean;
  proceduralHand: boolean;
}

export type ToggleKey =
  | 'showWebcam'
  | 'showFeedback'
  | 'mirrorX'
  | 'mirrorY'
  | 'swap'
  | 'dwell'
  | 'reducedMotion'
  | 'highContrast'
  | 'proceduralHand';

const COPY = {
  en: {
    controls: 'Controls',
    openControls: 'Open controls',
    closeControls: 'Close controls',
    feedback: 'Visual feedback + landmarks',
    mirrorX: 'Mirror X axis',
    mirrorY: 'Mirror Y axis',
    swap: 'Hands swap',
    dwell: 'Dwell to click',
    pinch: 'Pinch sensitivity',
    pinchFirm: 'Firm',
    pinchNormal: 'Normal',
    pinchLight: 'Light',
    webcam: 'Webcam preview',
    language: 'Language',
    quality: 'Quality',
    high: 'High',
    low: 'Fast',
    help: 'Gestures & help',
    retry: 'Enable camera',
    privacy: 'Video never leaves this device',
    accessibility: 'Accessibility',
    reducedMotion: 'Reduce motion',
    highContrast: 'High contrast',
    proceduralHand: 'Procedural hand (diagnostic)',
    projectLinks: 'Project links',
    github: 'GitHub',
    article: 'Learn article',
    newTab: 'opens in a new tab'
  },
  fr: {
    controls: 'Réglages',
    openControls: 'Ouvrir les réglages',
    closeControls: 'Fermer les réglages',
    feedback: 'Retour visuel + points',
    mirrorX: 'Miroir axe X',
    mirrorY: 'Miroir axe Y',
    swap: 'Inverser les mains',
    dwell: 'Clic par maintien',
    pinch: 'Sensibilité du pincement',
    pinchFirm: 'Ferme',
    pinchNormal: 'Normale',
    pinchLight: 'Légère',
    webcam: 'Aperçu caméra',
    language: 'Langue',
    quality: 'Qualité',
    high: 'Élevée',
    low: 'Rapide',
    help: 'Gestes et aide',
    retry: 'Activer la caméra',
    privacy: 'La vidéo ne quitte jamais cet appareil',
    accessibility: 'Accessibilité',
    reducedMotion: 'Réduire les animations',
    highContrast: 'Contraste élevé',
    proceduralHand: 'Main procédurale (diagnostic)',
    projectLinks: 'Liens du projet',
    github: 'GitHub',
    article: 'Lire l’article',
    newTab: 's’ouvre dans un nouvel onglet'
  }
};

export class ControlPanel {
  readonly root: HTMLElement;
  readonly preview = new WebcamPreview();
  private readonly switches = new Map<ToggleKey, HTMLButtonElement>();
  private readonly labels = new Map<ToggleKey, HTMLElement>();
  private readonly pinchButtons = new Map<number, HTMLButtonElement>();
  private readonly pinchLabel: HTMLElement;
  private copy = COPY.en;
  private readonly statusNode: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly retry: HTMLButtonElement;
  private readonly accessibilitySummary: HTMLElement;
  private readonly sheetToggle: HTMLButtonElement;
  private readonly sheetQuery: MediaQueryList;
  private sheetOpen = true;

  constructor(
    private readonly registry: ButtonRegistry,
    private state: ControlState,
    private readonly onToggle: (key: ToggleKey, value: boolean) => void,
    private readonly onLanguage: (lang: Language) => void,
    private readonly onQuality: (q: QualityMode) => void,
    private readonly onPinchSensitivity: (value: number) => void,
    private readonly onHelp: () => void,
    private readonly onRetry: () => void
  ) {
    this.copy = COPY[state.language];
    this.sheetQuery = window.matchMedia('(max-width: 1080px)');
    this.sheetOpen = !this.sheetQuery.matches;
    this.root = document.createElement('aside');
    this.root.id = 'celly-controls';
    this.root.className = 'controls glass';
    this.root.classList.toggle('is-open', this.sheetOpen);
    this.root.setAttribute('aria-label', this.copy.controls);

    const head = document.createElement('div');
    head.className = 'controls-head';
    const eyebrow = document.createElement('span');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = this.copy.controls;
    const tools = document.createElement('div');
    tools.className = 'controls-head-actions';

    const help = document.createElement('button');
    help.className = 'ghost-btn small help-btn';
    help.type = 'button';
    help.append(svgIcon(ICONS.help));
    help.setAttribute('aria-label', this.copy.help);
    help.addEventListener('click', this.onHelp);
    this.registry.register('control:help', help, this.onHelp);

    this.sheetToggle = document.createElement('button');
    this.sheetToggle.className = 'ghost-btn small sheet-toggle';
    this.sheetToggle.type = 'button';
    this.sheetToggle.append(svgIcon(ICONS.chevron));
    this.sheetToggle.setAttribute('aria-controls', 'celly-controls');
    this.sheetToggle.setAttribute('aria-expanded', String(this.sheetOpen));
    this.sheetToggle.setAttribute(
      'aria-label',
      this.sheetOpen ? this.copy.closeControls : this.copy.openControls
    );
    this.sheetToggle.addEventListener('click', () => this.setSheetOpen(!this.sheetOpen));
    this.registry.register('control:sheet', this.sheetToggle, () =>
      this.setSheetOpen(!this.sheetOpen)
    );

    tools.append(help, this.sheetToggle);
    head.append(eyebrow, tools);
    this.root.append(head, this.preview.root);
    this.sheetQuery.addEventListener('change', this.onSheetQueryChange);

    const list = document.createElement('div');
    list.className = 'controls-list';
    this.root.append(list);

    this.addRow(list, 'showFeedback', 'feedback', ICONS.eye);
    this.addRow(list, 'mirrorX', 'mirrorX', ICONS.flip);
    this.addRow(list, 'mirrorY', 'mirrorY', ICONS.flip);
    this.addRow(list, 'swap', 'swap', ICONS.swap);
    this.addRow(list, 'dwell', 'dwell', ICONS.spark);

    // Three discrete steps rather than a range input: every control in this panel is also
    // reachable with a pinch, and a native slider is a poor gesture target.
    const pinch = document.createElement('div');
    pinch.className = 'control-slider';
    const pinchName = document.createElement('div');
    pinchName.className = 'control-name';
    pinchName.append(svgIcon(ICONS.hand));
    this.pinchLabel = document.createElement('span');
    this.pinchLabel.textContent = this.copy.pinch;
    pinchName.append(this.pinchLabel);

    const pinchGroup = document.createElement('div');
    pinchGroup.className = 'segmented mini';
    pinchGroup.setAttribute('role', 'group');
    pinchGroup.setAttribute('aria-label', this.copy.pinch);
    const options: Array<[number, keyof typeof COPY.en]> = [
      [PINCH_SENSITIVITY.firm, 'pinchFirm'],
      [PINCH_SENSITIVITY.normal, 'pinchNormal'],
      [PINCH_SENSITIVITY.light, 'pinchLight']
    ];
    for (const [value, key] of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.pinch = String(value);
      b.textContent = this.copy[key] as string;
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', `${this.copy.pinch}: ${b.textContent}`);
      b.addEventListener('click', () => this.onPinchSensitivity(value));
      this.registry.register(`control:pinch:${value}`, b, () => this.onPinchSensitivity(value));
      pinchGroup.append(b);
      this.pinchButtons.set(value, b);
    }
    pinch.append(pinchName, pinchGroup);
    list.append(pinch);

    this.addRow(list, 'showWebcam', 'webcam', ICONS.camera);

    const more = document.createElement('details');
    more.className = 'controls-more';
    const summary = document.createElement('summary');
    summary.textContent = this.copy.accessibility;
    more.append(summary);
    const moreList = document.createElement('div');
    moreList.className = 'controls-list';
    more.append(moreList);
    this.addRow(moreList, 'reducedMotion', 'reducedMotion', ICONS.spark);
    this.addRow(moreList, 'highContrast', 'highContrast', ICONS.eye);
    this.addRow(moreList, 'proceduralHand', 'proceduralHand', ICONS.hand);
    this.root.append(more);
    this.accessibilitySummary = summary;

    this.statusNode = document.createElement('div');
    this.statusNode.className = 'camera-status';
    this.statusText = document.createElement('span');
    this.retry = document.createElement('button');
    this.retry.className = 'ghost-btn small accent';
    this.retry.type = 'button';
    this.retry.textContent = this.copy.retry;
    this.retry.addEventListener('click', this.onRetry);
    this.registry.register('control:retry', this.retry, this.onRetry);
    this.statusNode.append(this.statusText, this.retry);
    this.root.append(this.statusNode);

    const foot = document.createElement('div');
    foot.className = 'controls-foot';

    const langWrap = document.createElement('div');
    langWrap.className = 'segmented';
    langWrap.setAttribute('role', 'group');
    langWrap.setAttribute('aria-label', this.copy.language);
    for (const lang of ['en', 'fr'] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = lang.toUpperCase();
      b.dataset.lang = lang;
      b.addEventListener('click', () => this.onLanguage(lang));
      this.registry.register(`control:lang:${lang}`, b, () => this.onLanguage(lang));
      langWrap.append(b);
    }
    foot.append(langWrap);

    const qWrap = document.createElement('div');
    qWrap.className = 'segmented';
    qWrap.setAttribute('role', 'group');
    qWrap.setAttribute('aria-label', this.copy.quality);
    for (const q of ['high', 'low'] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = q === 'high' ? this.copy.high : this.copy.low;
      b.dataset.quality = q;
      b.addEventListener('click', () => this.onQuality(q));
      this.registry.register(`control:quality:${q}`, b, () => this.onQuality(q));
      qWrap.append(b);
    }
    foot.append(qWrap);
    this.root.append(foot);

    const projectLinks = document.createElement('nav');
    projectLinks.className = 'project-links';
    projectLinks.setAttribute('aria-label', this.copy.projectLinks);
    for (const kind of ['github', 'article'] as const) {
      const link = createProjectLink({
        kind,
        label: this.copy[kind],
        newTabLabel: this.copy.newTab
      });
      registerProjectLink(this.registry, `control:${kind}`, link);
      projectLinks.append(link);
    }
    this.root.append(projectLinks);

    const privacy = document.createElement('div');
    privacy.className = 'controls-privacy';
    privacy.innerHTML = `<i></i><span>${this.copy.privacy}</span>`;
    this.root.append(privacy);

    this.setState(state);
  }

  private readonly onSheetQueryChange = (event: MediaQueryListEvent): void => {
    this.setSheetOpen(!event.matches);
  };

  /** Collapse the panel to a header strip on phones and tablets. */
  setSheetOpen(open: boolean): void {
    this.sheetOpen = open;
    this.root.classList.toggle('is-open', open);
    this.sheetToggle.setAttribute('aria-expanded', String(open));
    this.sheetToggle.setAttribute(
      'aria-label',
      open ? this.copy.closeControls : this.copy.openControls
    );
    this.syncPreviewVisibility();
    // Cached gesture hit rects must follow the sheet through its transition.
    this.registry.refreshAll();
    requestAnimationFrame(() => this.registry.refreshAll());
    window.setTimeout(() => this.registry.refreshAll(), 340);
  }

  /** The thumbnail is only worth drawing when it can actually be seen. */
  private syncPreviewVisibility(): void {
    const sheetHidden = this.sheetQuery.matches && !this.sheetOpen;
    this.preview.setVisible(this.state.showWebcam && !sheetHidden);
  }

  private addRow(parent: HTMLElement, key: ToggleKey, labelKey: keyof typeof COPY.en, icon: string): void {
    const row = document.createElement('div');
    row.className = 'control-row';
    const left = document.createElement('div');
    left.className = 'control-name';
    left.append(svgIcon(icon));
    const label = document.createElement('span');
    label.textContent = this.copy[labelKey] as string;
    left.append(label);
    this.labels.set(key, label);

    const btn = document.createElement('button');
    btn.className = 'switch';
    btn.type = 'button';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-label', label.textContent ?? '');
    const knob = document.createElement('span');
    btn.append(knob);
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('aria-checked') !== 'true';
      this.onToggle(key, next);
    });
    this.registry.register(`control:${key}`, btn, () => {
      const next = btn.getAttribute('aria-checked') !== 'true';
      this.onToggle(key, next);
    });

    row.append(left, btn);
    parent.append(row);
    this.switches.set(key, btn);
  }

  setOn(key: ToggleKey, value: boolean): void {
    this.switches.get(key)?.setAttribute('aria-checked', String(value));
  }

  setState(state: ControlState): void {
    this.state = state;
    this.setOn('showWebcam', state.showWebcam);
    this.setOn('showFeedback', state.showFeedback);
    this.setOn('mirrorX', state.mirrorX);
    this.setOn('mirrorY', state.mirrorY);
    this.setOn('swap', state.swap);
    this.setOn('dwell', state.dwell);
    this.setOn('reducedMotion', state.reducedMotion);
    this.setOn('highContrast', state.highContrast);
    this.setOn('proceduralHand', state.proceduralHand);
    this.syncPreviewVisibility();

    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-lang]')) {
      b.classList.toggle('is-active', b.dataset.lang === state.language);
    }
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-quality]')) {
      b.classList.toggle('is-active', b.dataset.quality === state.quality);
    }
    for (const [value, b] of this.pinchButtons) {
      const active = Math.abs(value - state.pinchSensitivity) < 0.01;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    }
    if (this.copy !== COPY[state.language]) this.setLanguage(state.language);
  }

  setLanguage(language: Language): void {
    this.copy = COPY[language];
    this.preview.root.querySelector('.preview-empty span:last-child')?.replaceChildren(
      document.createTextNode(language === 'fr' ? 'Caméra éteinte' : 'Camera off')
    );
    const map: Array<[ToggleKey, keyof typeof COPY.en]> = [
      ['showFeedback', 'feedback'],
      ['mirrorX', 'mirrorX'],
      ['mirrorY', 'mirrorY'],
      ['swap', 'swap'],
      ['dwell', 'dwell'],
      ['showWebcam', 'webcam'],
      ['reducedMotion', 'reducedMotion'],
      ['highContrast', 'highContrast'],
      ['proceduralHand', 'proceduralHand']
    ];
    for (const [key, labelKey] of map) {
      const label = this.labels.get(key);
      if (label) {
        label.textContent = this.copy[labelKey] as string;
        this.switches.get(key)?.setAttribute('aria-label', label.textContent ?? '');
      }
    }
    const headEyebrow = this.root.querySelector('.controls-head .eyebrow');
    if (headEyebrow) headEyebrow.textContent = this.copy.controls;
    this.retry.textContent = this.copy.retry;
    const qualityLabel = this.root.querySelector('[data-quality="high"]');
    const fastLabel = this.root.querySelector('[data-quality="low"]');
    if (qualityLabel) qualityLabel.textContent = this.copy.high;
    if (fastLabel) fastLabel.textContent = this.copy.low;
    const help = this.root.querySelector('.controls-head .help-btn');
    help?.setAttribute('aria-label', this.copy.help);
    this.sheetToggle.setAttribute(
      'aria-label',
      this.sheetOpen ? this.copy.closeControls : this.copy.openControls
    );
    const privacy = this.root.querySelector('.controls-privacy span');
    if (privacy) privacy.textContent = this.copy.privacy;
    this.accessibilitySummary.textContent = this.copy.accessibility;

    this.root.querySelector('.project-links')?.setAttribute('aria-label', this.copy.projectLinks);
    for (const link of this.root.querySelectorAll<HTMLAnchorElement>('.project-links [data-project-link]')) {
      const kind = link.dataset.projectLink;
      if (kind === 'github' || kind === 'article') {
        updateProjectLink(link, this.copy[kind], this.copy.newTab);
      }
    }

    this.pinchLabel.textContent = this.copy.pinch;
    const pinchOptions: Array<[number, keyof typeof COPY.en]> = [
      [PINCH_SENSITIVITY.firm, 'pinchFirm'],
      [PINCH_SENSITIVITY.normal, 'pinchNormal'],
      [PINCH_SENSITIVITY.light, 'pinchLight']
    ];
    for (const [value, key] of pinchOptions) {
      const button = this.pinchButtons.get(value);
      if (button) {
        button.textContent = this.copy[key] as string;
        button.setAttribute('aria-label', `${this.copy.pinch}: ${button.textContent}`);
      }
    }
  }

  setCameraStatus(status: CameraStatus, detail?: string): void {
    const live = status === 'live';
    this.statusNode.classList.toggle('is-error', status === 'denied' || status === 'unsupported' || status === 'in-use' || status === 'not-found');
    this.statusNode.classList.toggle('is-ok', live);
    this.retry.classList.toggle('is-hidden', live);
    if (live) this.statusText.textContent = this.state.language === 'fr' ? 'Caméra active' : 'Camera live';
    else if (status === 'requesting') this.statusText.textContent = this.state.language === 'fr' ? 'Autorisation…' : 'Requesting…';
    else this.statusText.textContent = detail ?? '';
    this.preview.setStatus(live, live ? '' : this.state.language === 'fr' ? 'Caméra éteinte' : 'Camera off');
  }
}
