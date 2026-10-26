import type { ButtonRegistry } from './buttons';
import { svgIcon, ICONS } from './dom';
import { createProjectLink, registerProjectLink } from './projectLinks';

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
  private readonly card: HTMLElement;
  private step = 0;
  private language: Language = 'en';
  private hands = 0;
  private cameraRequested = false;
  private unregister: Array<() => void> = [];

  constructor(
    private readonly registry: ButtonRegistry,
    private readonly opts: OnboardingOptions
  ) {
    this.root = document.createElement('div');
    this.root.className = 'onboarding';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.card = document.createElement('div');
    this.card.className = 'onboarding-card';
    this.root.append(this.card);
    this.render();
  }

  get isOpen(): boolean {
    return this.root.classList.contains('is-open');
  }

  open(): void {
    this.step = 0;
    this.root.classList.add('is-open');
    this.render();
  }

  close(): void {
    this.root.classList.remove('is-open');
    this.teardown();
  }

  setLanguage(language: Language): void {
    this.language = language;
    if (this.isOpen) this.render();
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

  cameraBlocked(message: string): void {
    const node = this.card.querySelector('.onboarding-error');
    if (node) {
      node.textContent = message;
      node.classList.add('is-visible');
    }
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
    if (this.step === 1) this.setHands(this.hands);
  }

  private handlerFor(id: string): (() => void) | null {
    switch (id) {
      case 'enable':
        return () => {
          this.cameraRequested = true;
          this.opts.onEnableCamera();
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
        return () => {
          this.close();
          this.opts.onComplete(this.cameraRequested);
        };
      default:
        return null;
    }
  }

  private goTo(step: number): void {
    this.step = step;
    this.render();
    requestAnimationFrame(() => this.registry.refreshAll());
  }

  private renderIntro(copy: (typeof COPY)['en']): string {
    return `
      <div class="onboarding-visual">
        <div class="orb"><i></i><i></i><i></i><b></b></div>
        <span class="orb-tag">CELL · MODEL</span>
      </div>
      <div class="onboarding-body">
        <span class="eyebrow">${copy.kicker}</span>
        <h1>${copy.title}</h1>
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
        <div class="onboarding-error"></div>
      </div>
    `;
  }

  private renderHands(copy: (typeof COPY)['en']): string {
    return `
      <div class="onboarding-body narrow">
        <span class="eyebrow">${copy.step2kicker}</span>
        <h2>${copy.step2title}</h2>
        <p class="onboarding-lead">${copy.step2lead}</p>
        <p class="onboarding-hint">${copy.step2hint}</p>
        <div class="hands-status">
          <div class="hand-hand">
            <span class="hand-dot" data-index="0"></span>
            <span class="hand-dot" data-index="1"></span>
          </div>
          <span class="hands-label">${this.hands === 0 ? copy.hands0 : this.hands === 1 ? copy.hands1 : copy.hands2}</span>
        </div>
        <div class="onboarding-frame">
          <div class="frame-corner tl"></div><div class="frame-corner tr"></div>
          <div class="frame-corner bl"></div><div class="frame-corner br"></div>
          <div class="frame-scan"></div>
          <span>${this.language === 'fr' ? 'CADRE DE DÉTECTION' : 'TRACKING FRAME'}</span>
        </div>
        <div class="onboarding-actions">
          <button class="btn ghost" type="button" data-celly="back"><span>${this.language === 'fr' ? 'Retour' : 'Back'}</span></button>
          <button class="btn primary" type="button" data-celly="next"><span>${copy.next}</span></button>
        </div>
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
        <h2>${copy.step3title}</h2>
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
          <button class="btn ghost" type="button" data-celly="back"><span>${this.language === 'fr' ? 'Retour' : 'Back'}</span></button>
          <button class="btn primary" type="button" data-celly="enter">
            ${svgIcon(ICONS.lab).outerHTML}<span>${copy.enter}</span>
          </button>
        </div>
      </div>
    `;
  }

  private teardown(): void {
    for (const fn of this.unregister) fn();
    this.unregister = [];
  }
}
