import type { ButtonRegistry } from './buttons';
import type { CameraStatus, HandFrame, Settings } from '../types';
import { svgIcon, ICONS } from './dom';
import { createProjectLink, registerProjectLink } from './projectLinks';
import { WebcamPreview } from './webcamPreview';

const COPY = {
  en: {
    kicker: 'Celly · v0.2',
    title: 'A cell you can hold.',
    lead: 'Steer a living cell with your bare hands. No controller, no headset — just your webcam and a pinch.',
    privacy: 'Video is processed on this device and never uploaded.',
    enable: 'Enable camera',
    mouse: 'Continue with mouse',
    step2kicker: 'Step 1 of 2',
    step2title: 'Show me your hands',
    step2lead:
      'Sit 60–80 cm from the camera, at eye level, with your hands inside the frame. Celly needs to see your thumb and index finger clearly.',
    step2hint: 'The outer edge of the frame is ignored, so you can reach every corner of the screen.',
    hands0: 'No hands yet',
    hands1: '1 hand detected',
    hands2: '2 hands detected',
    cameraOff: 'Camera is off. You can turn it on here, or keep exploring with the mouse.',
    cameraOffShort: 'Camera off',
    cameraConnecting: 'Connecting…',
    cameraRequesting: 'Waiting for camera permission…',
    cameraLive: 'Camera live — show one hand to check the skeleton.',
    cameraError: 'Camera unavailable. You can still explore with the mouse.',
    enableHere: 'Enable camera',
    retry: 'Try again',
    next: 'Continue',
    step3kicker: 'Step 2 of 2',
    step3title: 'Four gestures, that is all',
    step3lead: 'Pinch with your thumb and index finger. Everything else follows.',
    g1: 'Select',
    g1s: 'Right pinch on an organelle',
    g2: 'Click',
    g2s: 'Right pinch on a button',
    g3: 'Rotate',
    g3s: 'Left pinch and move',
    g4: 'Scale',
    g4s: 'Pinch with both hands',
    enter: 'Enter the lab',
    skip: 'Skip tour',
    back: 'Back',
    settings: 'Camera settings',
    blocked: 'Camera unavailable. You can still explore with the mouse.',
    projectLinks: 'Project links',
    github: 'GitHub',
    article: 'Learn article',
    newTab: 'opens in a new tab'
  },
  fr: {
    kicker: 'Celly · v0.2',
    title: 'Une cellule entre vos mains.',
    lead: 'Pilotez une cellule vivante à mains nues. Sans manette, sans casque — juste votre webcam et un pincement.',
    privacy: 'La vidéo est traitée sur cet appareil et ne quitte jamais votre machine.',
    enable: 'Activer la caméra',
    mouse: 'Continuer à la souris',
    step2kicker: 'Étape 1 sur 2',
    step2title: 'Montrez-moi vos mains',
    step2lead:
      'Placez-vous à 60–80 cm de la caméra, à hauteur des yeux, les mains dans le cadre. Celly doit voir clairement votre pouce et votre index.',
    step2hint:
      'Le bord du cadre est ignoré : vous pouvez atteindre chaque coin de l’écran sans vous pencher.',
    hands0: 'Aucune main',
    hands1: '1 main détectée',
    hands2: '2 mains détectées',
    cameraOff: 'La caméra est éteinte. Activez-la ici, ou continuez à la souris.',
    cameraOffShort: 'Caméra éteinte',
    cameraConnecting: 'Connexion…',
    cameraRequesting: 'En attente de l’autorisation caméra…',
    cameraLive: 'Caméra active — montrez une main pour vérifier le squelette.',
    cameraError: 'Caméra indisponible. Vous pouvez explorer à la souris.',
    enableHere: 'Activer la caméra',
    retry: 'Réessayer',
    next: 'Continuer',
    step3kicker: 'Étape 2 sur 2',
    step3title: 'Quatre gestes, c’est tout',
    step3lead: 'Pincez avec le pouce et l’index. Le reste suit naturellement.',
    g1: 'Sélectionner',
    g1s: 'Pincement droit sur un organite',
    g2: 'Cliquer',
    g2s: 'Pincement droit sur un bouton',
    g3: 'Tourner',
    g3s: 'Pincement gauche et déplacement',
    g4: 'Mettre à l’échelle',
    g4s: 'Pincement des deux mains',
    enter: 'Entrer au laboratoire',
    skip: 'Passer la visite',
    back: 'Retour',
    settings: 'Réglages caméra',
    blocked: 'Caméra indisponible. Vous pouvez explorer à la souris.',
    projectLinks: 'Liens du projet',
    github: 'GitHub',
    article: 'Lire l’article',
    newTab: 's’ouvre dans un nouvel onglet'
  }
};

export interface OnboardingOptions {
  onEnableCamera: () => void;
  onComplete: (cameraRequested: boolean) => void;
}

type Language = keyof typeof COPY;

export class Onboarding {
  readonly root: HTMLElement;
  readonly preview = new WebcamPreview();
  private readonly card: HTMLElement;
  private step = 0;
  private language: Language = 'en';
  private hands = 0;
  private cameraRequested = false;
  private cameraStatus: CameraStatus = 'idle';
  private cameraDetail = '';
  private error = '';
  private unregister: Array<() => void> = [];
  private previousFocus: HTMLElement | null = null;

  constructor(
    private readonly registry: ButtonRegistry,
    private readonly opts: OnboardingOptions
  ) {
    this.root = document.createElement('div');
    this.root.className = 'onboarding';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'celly-onboarding-title');
    this.card = document.createElement('div');
    this.card.className = 'onboarding-card';
    this.root.append(this.card);
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.skip();
    });
    document.addEventListener('keydown', this.onKeyDown);
    this.render();
  }

  get isOpen(): boolean {
    return this.root.classList.contains('is-open');
  }

  open(): void {
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.step = 0;
    this.hands = 0;
    this.root.classList.add('is-open');
    this.render();
    requestAnimationFrame(() => {
      this.card.querySelector<HTMLElement>('[data-celly="enable"]')?.focus();
    });
  }

  close(): void {
    this.root.classList.remove('is-open');
    this.teardown();
    this.previousFocus?.focus?.();
    this.previousFocus = null;
  }

  setLanguage(language: Language): void {
    this.language = language;
    if (this.isOpen) this.render();
  }

  attachVideo(video: HTMLVideoElement | null): void {
    this.preview.attach(video);
  }

  drawPreview(frames: HandFrame[], settings: Settings): void {
    if (!this.isOpen || this.step !== 1) return;
    this.preview.draw(frames, settings);
  }

  setHands(count: number): void {
    this.hands = count;
    if (this.step !== 1) return;
    const label = this.card.querySelector('.hands-label');
    const copy = COPY[this.language];
    if (label) label.textContent = count === 0 ? copy.hands0 : count === 1 ? copy.hands1 : copy.hands2;
    this.card.querySelector('.hands-status')?.classList.toggle('is-live', count > 0);
    for (const dot of this.card.querySelectorAll('.hand-dot')) {
      dot.classList.toggle('is-on', Number((dot as HTMLElement).dataset.index) < count);
    }
  }

  /**
   * Camera UI lives in the hands step, so errors must be re-rendered there instead of being
   * written once into the intro. Keeping the message in state also survives Back/Next.
   */
  setCameraStatus(status: CameraStatus, detail?: string): void {
    this.cameraStatus = status;
    this.cameraDetail = detail ?? '';
    if (status === 'live') this.error = '';
    else if (isCameraError(status)) this.error = detail || COPY[this.language].blocked;
    else if (status === 'requesting') this.error = '';
    this.syncError();
    this.syncCameraStep();
  }

  private skip(): void {
    this.close();
    this.opts.onComplete(this.cameraRequested);
  }

  private render(): void {
    this.teardown();
    const copy = COPY[this.language];
    const steps = [this.renderIntro(copy), this.renderHands(copy), this.renderGestures(copy)];
    this.card.innerHTML = steps[this.step] ?? steps[0];
    this.card.dataset.step = String(this.step);

    const projectLinks = this.card.querySelector<HTMLElement>('[data-project-links]');
    if (projectLinks) {
      for (const kind of ['github', 'article'] as const) {
        const link = createProjectLink({
          kind,
          label: copy[kind],
          newTabLabel: copy.newTab
        });
        this.unregister.push(registerProjectLink(this.registry, `onboarding:${kind}`, link));
        projectLinks.append(link);
      }
    }

    for (const btn of this.card.querySelectorAll<HTMLButtonElement>('[data-celly]')) {
      const id = btn.dataset.celly as string;
      const handler = this.handlerFor(id);
      if (!handler) continue;
      btn.addEventListener('click', handler);
      this.unregister.push(this.registry.register(`onboarding:${id}`, btn, handler));
    }

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'onboarding-skip ghost-btn small';
    skip.dataset.celly = 'skip';
    skip.textContent = copy.skip;
    const skipHandler = this.handlerFor('skip');
    if (skipHandler) {
      skip.addEventListener('click', skipHandler);
      this.unregister.push(this.registry.register('onboarding:skip', skip, skipHandler));
    }
    this.card.append(skip);

    if (this.step === 1) {
      const slot = this.card.querySelector('.onboarding-preview-slot');
      if (slot) slot.append(this.preview.root);
      this.preview.setVisible(true);
      this.setHands(this.hands);
      this.syncCameraStep();
    }
    this.syncError();
    this.registry.refreshAll();
  }

  private handlerFor(id: string): (() => void) | null {
    switch (id) {
      case 'enable':
        return () => {
          if (this.cameraStatus !== 'live') {
            this.cameraRequested = true;
            this.opts.onEnableCamera();
          }
          this.goTo(1);
        };
      case 'mouse':
        return () => {
          this.goTo(1);
        };
      case 'next':
        return () => this.goTo(Math.min(2, this.step + 1));
      case 'back':
        return () => this.goTo(Math.max(0, this.step - 1));
      case 'enter':
        return () => {
          this.close();
          this.opts.onComplete(this.cameraRequested);
        };
      case 'skip':
        return () => this.skip();
      default:
        return null;
    }
  }

  private goTo(step: number): void {
    this.step = step;
    this.render();
    requestAnimationFrame(() => {
      this.registry.refreshAll();
      this.card.querySelector<HTMLElement>('[data-celly="next"], [data-celly="enter"]')?.focus();
    });
  }

  private renderIntro(copy: (typeof COPY)['en']): string {
    return `
      <div class="onboarding-visual">
        <div class="orb"><i></i><i></i><i></i><b></b></div>
        <span class="orb-tag">CELL · MODEL</span>
      </div>
      <div class="onboarding-body">
        <span class="eyebrow">${copy.kicker}</span>
        <h1 id="celly-onboarding-title">${copy.title}</h1>
        <p class="onboarding-lead">${copy.lead}</p>
        <div class="onboarding-privacy">
          ${svgIcon(ICONS.privacy).outerHTML}
          <span>${copy.privacy}</span>
        </div>
        <nav class="onboarding-links" aria-label="${copy.projectLinks}" data-project-links></nav>
        <div class="onboarding-actions">
          <button class="btn primary" type="button" data-celly="enable">
            ${svgIcon(ICONS.camera).outerHTML}<span>${copy.enable}</span>
          </button>
          <button class="btn ghost" type="button" data-celly="mouse"><span>${copy.mouse}</span></button>
        </div>
        ${this.errorMarkup()}
      </div>
    `;
  }

  private renderHands(copy: (typeof COPY)['en']): string {
    return `
      <div class="onboarding-body narrow">
        <span class="eyebrow">${copy.step2kicker}</span>
        <h2 id="celly-onboarding-title">${copy.step2title}</h2>
        <p class="onboarding-lead">${copy.step2lead}</p>
        <div class="onboarding-preview">
          <div class="onboarding-preview-slot"></div>
          <div class="onboarding-camera-bar">
            <span class="camera-state"><i></i><span data-camera-state></span></span>
          </div>
        </div>
        <p class="onboarding-hint">${copy.step2hint}</p>
        <div class="hands-status">
          <div class="hand-hand">
            <span class="hand-dot" data-index="0"></span>
            <span class="hand-dot" data-index="1"></span>
          </div>
          <span class="hands-label">${this.hands === 0 ? copy.hands0 : this.hands === 1 ? copy.hands1 : copy.hands2}</span>
        </div>
        <div class="onboarding-camera-actions" data-camera-actions>
          <button class="btn primary small" type="button" data-celly="enable">
            ${svgIcon(ICONS.camera).outerHTML}<span data-enable-label>${copy.enableHere}</span>
          </button>
        </div>
        <div class="onboarding-actions">
          <button class="btn ghost" type="button" data-celly="back"><span>${copy.back}</span></button>
          <button class="btn primary" type="button" data-celly="next"><span>${copy.next}</span></button>
        </div>
        ${this.errorMarkup()}
      </div>
    `;
  }

  private renderGestures(copy: (typeof COPY)['en']): string {
    const cards: Array<[string, string, string]> = [
      [ICONS.hand, copy.g1, copy.g1s],
      [ICONS.quiz, copy.g2, copy.g2s],
      [ICONS.rotate, copy.g3, copy.g3s],
      [ICONS.scale, copy.g4, copy.g4s]
    ];
    return `
      <div class="onboarding-body wide">
        <span class="eyebrow">${copy.step3kicker}</span>
        <h2 id="celly-onboarding-title">${copy.step3title}</h2>
        <p class="onboarding-lead">${copy.step3lead}</p>
        <div class="gesture-cards">
          ${cards
            .map(
              ([icon, title, sub], i) => `
            <div class="gesture-card" style="--i:${i}">
              <span class="gesture-num">${String(i + 1).padStart(2, '0')}</span>
              ${svgIcon(icon).outerHTML}
              <b>${title}</b>
              <span>${sub}</span>
            </div>`
            )
            .join('')}
        </div>
        <div class="onboarding-actions">
          <button class="btn ghost" type="button" data-celly="back"><span>${copy.back}</span></button>
          <button class="btn primary" type="button" data-celly="enter">
            ${svgIcon(ICONS.lab).outerHTML}<span>${copy.enter}</span>
          </button>
        </div>
        ${this.errorMarkup()}
      </div>
    `;
  }

  private errorMarkup(): string {
    return `<div class="onboarding-error${this.error ? ' is-visible' : ''}" role="status" aria-live="polite">${escapeHtml(this.error)}</div>`;
  }

  private syncError(): void {
    const node = this.card.querySelector<HTMLElement>('.onboarding-error');
    if (!node) return;
    node.textContent = this.error;
    node.classList.toggle('is-visible', !!this.error);
  }

  private syncCameraStep(): void {
    if (this.step !== 1) return;
    const copy = COPY[this.language];
    const status = this.cameraStatus;
    const state = this.card.querySelector<HTMLElement>('[data-camera-state]');
    const bar = this.card.querySelector<HTMLElement>('.onboarding-camera-bar');
    if (state) {
      state.textContent =
        status === 'live'
          ? copy.cameraLive
          : status === 'requesting'
            ? copy.cameraRequesting
            : status === 'idle'
              ? copy.cameraOff
              : this.cameraDetail || copy.cameraError;
    }
    if (bar) bar.dataset.state = status;
    this.preview.setStatus(
      status === 'live',
      status === 'requesting' ? copy.cameraConnecting : copy.cameraOffShort
    );
    const enable = this.card.querySelector<HTMLButtonElement>('[data-camera-actions] [data-celly="enable"]');
    if (!enable) return;
    enable.hidden = status === 'live';
    enable.disabled = status === 'requesting';
    enable.classList.toggle('is-hidden', status === 'live');
    const label = enable.querySelector('[data-enable-label]');
    if (label) {
      label.textContent = status === 'requesting' ? copy.cameraRequesting : isCameraError(status) ? copy.retry : copy.enableHere;
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.skip();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...this.card.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([hidden]), a[href], [tabindex]:not([tabindex="-1"])'
    )].filter((node) => node.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  private teardown(): void {
    for (const fn of this.unregister) fn();
    this.unregister = [];
  }
}

function isCameraError(status: CameraStatus): boolean {
  return (
    status === 'denied' ||
    status === 'not-found' ||
    status === 'in-use' ||
    status === 'insecure-context' ||
    status === 'unsupported' ||
    status === 'timeout'
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
