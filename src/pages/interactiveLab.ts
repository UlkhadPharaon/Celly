import * as THREE from 'three';
import type { InteractionMode } from '../study/types';
import type { GestureState, Intent, Language } from '../types';
import type { OrganelleId } from '../scene/types';
import { CellModel } from '../scene/cellModel';
import { ORGANELLES, ORGANELLE_BY_ID, loc, locList } from '../data/catalog';
import { Tweens, ease } from '../core/tween';
import { clamp } from '../core/math';
import { type Page, type PageContext, type PickOptions, pageHeader } from './page';
import { nearestWithin } from '../gestures/aim';
import { escapeHtml } from '../ui/dom';

export const COPY = {
  en: {
    eyebrow: 'Interactive lab',
    title: 'The animal cell',
    lead: 'Pinch a structure to isolate it. Pinch empty space to release.',
    pointerLead: 'Drag, pinch or scroll to turn and zoom. Tap a part to open it.',
    hintIdle: 'Pinch a structure to explore',
    pointerHintIdle: 'Drag to turn · pinch or scroll to zoom',
    hintSelected: 'Pinch empty space to release · left pinch to rotate',
    pointerHintSelected: 'Tap empty space to close · drag to turn',
    index: 'Structures',
    organelle: 'Organelle',
    function: 'Function',
    structure: 'Structure',
    fact: 'Did you know',
    related: 'Related',
    openKnowledge: 'Open in Knowledge',
    isolate: 'Isolate',
    undo: 'Undo',
    prev: 'Previous structure',
    next: 'Next structure'
  },
  fr: {
    eyebrow: 'Laboratoire interactif',
    title: 'La cellule animale',
    lead: 'Pincez une structure pour l’isoler. Pincez le vide pour revenir.',
    pointerLead: 'Glissez, pincez ou faites défiler pour tourner et zoomer. Touchez une structure pour l’ouvrir.',
    hintIdle: 'Pincez une structure pour l’explorer',
    pointerHintIdle: 'Glissez pour tourner · pincez ou défilez pour zoomer',
    hintSelected: 'Pincez le vide pour relâcher · pincement gauche pour tourner',
    pointerHintSelected: 'Touchez le vide pour fermer · glissez pour tourner',
    index: 'Structures',
    organelle: 'Organite',
    function: 'Fonction',
    structure: 'Structure',
    fact: 'Le saviez-vous',
    related: 'Lié à',
    openKnowledge: 'Ouvrir dans Savoirs',
    isolate: 'Isoler',
    undo: 'Annuler',
    prev: 'Structure précédente',
    next: 'Structure suivante'
  }
};

const IDS = ORGANELLES.map((o) => o.id as OrganelleId);

/**
 * Radians of rig rotation per normalised unit of palm travel. The palm crosses the whole screen
 * (1.0) in a large sweep, so 3.2 gives roughly half a turn edge to edge — enough to look around
 * the cell without the wrist leaving the camera frame.
 */
const ROTATE_GAIN = 3.2;

export class InteractiveLabPage implements Page {
  readonly id = 'interactive' as const;
  readonly root: HTMLElement;

  private readonly rig = new THREE.Group();
  private readonly zoom = new THREE.Group();
  private readonly focus = new THREE.Group();
  private readonly cell = new CellModel();
  private readonly tweens = new Tweens();
  private readonly inertia = new THREE.Vector2();
  /** Reused by `pick()` so the per-pointer-frame loop stays allocation-free. */
  private readonly viewScratch = new THREE.Vector3();

  private selected: OrganelleId | null = null;
  private hovered: OrganelleId | null = null;
  private rotateHeld = false;
  /** Absolute rotation anchor for the current left-hand gesture, or null when not rotating. */
  private rotateAnchor: {
    startX: number;
    startY: number;
    palmX: number;
    palmY: number;
    rotY: number;
    rotX: number;
  } | null = null;
  private scaleBase = 1;
  private lastGesture: GestureState = 'IDLE';
  private pausedUntil = 0;
  private anchorClock = 0;
  private readonly anchorMemory = new Map<OrganelleId, { x: number; y: number }>();
  private language: Language;
  private mode: InteractionMode;
  private readonly labels = new Map<string, HTMLElement>();
  private readonly chips = new Map<string, HTMLElement>();
  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly lead: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly indexLabel: HTMLElement;
  private readonly testPanel: HTMLElement;
  private readonly testMarker: HTMLElement;
  private test: {
    ids: OrganelleId[];
    index: number;
    attempts: number;
    hits: number;
    errors: number[];
    results: Array<{ target: OrganelleId; hit: boolean; errorPx: number | null }>;
    complete: boolean;
  } | null = null;
  private testBusy = false;
  private testTarget: OrganelleId | null = null;
  private savedAutoRotate = true;

  constructor(private readonly ctx: PageContext) {
    this.language = ctx.settings.language;
    this.mode = ctx.mode;
    this.root = document.createElement('section');
    this.root.className = 'page page-lab';

    const header = pageHeader({ eyebrow: '', title: '', lead: '' });
    this.root.append(header);
    this.eyebrow = header.querySelector('.eyebrow') as HTMLElement;
    this.title = header.querySelector('h1') as HTMLElement;
    this.lead = header.querySelector('p') as HTMLElement;

    this.hint = document.createElement('div');
    this.hint.className = 'lab-hint';
    this.hint.innerHTML = '<i class="live-dot"></i><span></span>';
    this.root.append(this.hint);

    // Built-in selection test: deterministic targets, actual pinch intents, measured aim error.
    this.testPanel = document.createElement('div');
    this.testPanel.className = 'lab-test-panel';
    this.testPanel.hidden = true;
    this.testPanel.innerHTML = `
      <div class="lab-test-head">
        <span class="eyebrow">Selection test</span>
        <button type="button" class="lab-test-close" data-test="close" aria-label="Close">×</button>
      </div>
      <div class="lab-test-target">—</div>
      <div class="lab-test-bar"><i></i></div>
      <div class="lab-test-stats">0 / 0 · 0% · 0 px</div>
      <div class="lab-test-list"></div>
      <div class="lab-test-actions">
        <button type="button" class="ghost-btn small" data-test="restart">Restart</button>
        <button type="button" class="ghost-btn small" data-test="stop">Stop</button>
      </div>
    `;
    this.root.append(this.testPanel);
    this.testMarker = document.createElement('div');
    this.testMarker.className = 'lab-test-marker';
    this.testMarker.hidden = true;
    this.testMarker.innerHTML = '<i></i><b></b>';
    this.root.append(this.testMarker);
    this.testPanel.querySelector('[data-test="close"]')?.addEventListener('click', () => this.stopSelectionTest());
    this.testPanel.querySelector('[data-test="stop"]')?.addEventListener('click', () => this.stopSelectionTest());
    this.testPanel.querySelector('[data-test="restart"]')?.addEventListener('click', () => this.startSelectionTest(true));

    const rail = document.createElement('div');
    rail.className = 'structure-rail';
    rail.dataset.tour = 'structure';
    const railHead = document.createElement('div');
    railHead.className = 'structure-rail-head';
    railHead.innerHTML = `<span class="eyebrow"></span><span class="structure-count">${IDS.length}</span>`;
    this.indexLabel = railHead.querySelector('.eyebrow') as HTMLElement;
    rail.append(railHead);
    const scroller = document.createElement('div');
    scroller.className = 'structure-scroll';
    for (const meta of ORGANELLES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'structure-chip';
      btn.dataset.id = meta.id;
      btn.style.setProperty('--chip', meta.color);
      const dot = document.createElement('i');
      const label = document.createElement('span');
      label.textContent = loc(meta.name, this.language);
      btn.append(dot, label);
      btn.addEventListener('click', () => this.select(meta.id as OrganelleId));
      this.ctx.registry.register(`lab:chip:${meta.id}`, btn, () => this.select(meta.id as OrganelleId));
      this.chips.set(meta.id, btn);
      this.labels.set(meta.id, label);
      scroller.append(btn);
    }
    rail.append(scroller);
    this.root.append(rail);

    this.rig.add(this.zoom);
    this.zoom.add(this.focus);
    this.focus.add(this.cell.root);
    this.rig.position.y = 0;
    this.rig.rotation.set(-0.06, 0.45, 0);
    ctx.scene.labGroup.add(this.rig);

    this.zoom.scale.setScalar(0.72);
    this.tweens.add(1100, (t) => this.zoom.scale.setScalar(0.72 + 0.28 * t), ease.outCubic);

    this.setLanguage(this.language);
    this.syncRail();
  }

  // ------------------------------------------------------------------ lifecycle

  enter(): void {
    this.rig.visible = true;
    this.root.classList.add('is-active');
    this.ctx.overlay.hide();
    if (this.selected) this.openOverlay(this.selected);
    this.updateHint();
    requestAnimationFrame(() => this.ctx.registry.refreshAll());
  }

  exit(): void {
    this.rig.visible = false;
    this.root.classList.remove('is-active');
    this.ctx.overlay.hide();
    this.stopSelectionTest();
  }

  setAutoRotate(value: boolean): void {
    if (!value) this.pausedUntil = 0;
    this.autoRotate = value;
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    this.tweens.reducedMotion = value;
    if (value) {
      this.tweens.finishAll();
      this.inertia.set(0, 0);
    }
  }

  /** Test hook: the rig's current Y rotation, used by the reduce-motion E2E. */
  /** Current Y rotation of the cell rig (hands or pointer). */
  get rigRotationY(): number {
    return this.rig.rotation.y;
  }

  private autoRotate = true;
  private reducedMotion = false;

  setMode(mode: InteractionMode): void {
    this.mode = mode;
    this.setLanguage(this.language);
  }

  setLanguage(language: Language): void {
    this.language = language;
    const copy = COPY[language];
    this.eyebrow.textContent = copy.eyebrow;
    this.title.textContent = copy.title;
    this.lead.textContent = this.mode === 'hands' ? copy.lead : copy.pointerLead;
    this.indexLabel.textContent = copy.index;
    for (const meta of ORGANELLES) {
      const label = this.labels.get(meta.id);
      if (label) label.textContent = loc(meta.name, language);
    }
    this.updateHint();
    if (this.selected) this.openOverlay(this.selected);
    if (this.test) this.updateTestPanel();
  }

  // ------------------------------------------------------------------ selection

  select(id: OrganelleId): void {
    if (!this.cell.parts.has(id)) return;
    this.selected = id;
    this.cell.setSelected(id);
    // Selecting focuses the part and gently dims the rest. Isolation is a separate, stronger
    // state the participant opts into from the card, so it survives a re-selection.
    this.cell.setFocusDim(id);
    this.syncRail();
    this.pausedUntil = 0;

    const center = this.cell.getCenter(id);
    const radius = this.cell.getRadius(id);
    const s = clamp(1.06 / Math.max(0.08, radius), 0.82, 5.6);
    const fromPos = this.focus.position.clone();
    const fromScale = this.cell.root.scale.x;
    const toPos = center.clone().multiplyScalar(-s);

    this.tweens.add(
      860,
      (t) => {
        this.focus.position.lerpVectors(fromPos, toPos, t);
        this.cell.root.scale.setScalar(fromScale + (s - fromScale) * t);
      },
      ease.inOutCubic
    );

    this.openOverlay(id);
    this.updateHint();
  }

  unselect(): void {
    if (!this.selected) return;
    this.selected = null;
    this.cell.setSelected(null);
    this.cell.setFocusDim(null);
    this.cell.setIsolation(null);
    this.syncRail();
    this.ctx.overlay.hide();

    const fromPos = this.focus.position.clone();
    const fromScale = this.cell.root.scale.x;
    this.tweens.add(
      700,
      (t) => {
        this.focus.position.lerpVectors(fromPos, new THREE.Vector3(), t);
        this.cell.root.scale.setScalar(fromScale + (1 - fromScale) * t);
      },
      ease.outCubic
    );
    this.updateHint();
  }

  closeOverlay(): void {
    this.unselect();
  }

  /**
   * Back to the default framing: no selection, no isolation, rotation and scale at rest.
   * Bound to the "Reset view" button so a participant who has spun or zoomed the cell far from
   * home is never stuck — the only other way back was a reload.
   */
  resetView(): void {
    this.selected = null;
    this.cell.setSelected(null);
    this.cell.setFocusDim(null);
    this.cell.setIsolation(null);
    this.syncRail();
    this.ctx.overlay.hide();

    const fromPos = this.focus.position.clone();
    const fromScale = this.cell.root.scale.x;
    const fromRotY = this.rig.rotation.y;
    const fromRotX = this.rig.rotation.x;
    const fromZoom = this.zoom.scale.x;
    this.inertia.set(0, 0);
    this.rotateHeld = false;
    this.rotateAnchor = null;
    this.pausedUntil = 0;

    this.tweens.add(
      620,
      (t) => {
        this.focus.position.lerpVectors(fromPos, new THREE.Vector3(), t);
        this.cell.root.scale.setScalar(fromScale + (1 - fromScale) * t);
        this.rig.rotation.y = fromRotY + (0.45 - fromRotY) * t;
        this.rig.rotation.x = fromRotX + (-0.06 - fromRotX) * t;
        this.zoom.scale.setScalar(fromZoom + (0.72 - fromZoom) * t);
      },
      ease.outCubic
    );
    this.updateHint();
  }

  private openOverlay(id: OrganelleId): void {
    const meta = ORGANELLE_BY_ID.get(id);
    if (!meta) return;
    const copy = COPY[this.language];

    this.ctx.overlay.show(
      {
        eyebrow: copy.organelle,
        title: loc(meta.name, this.language),
        accent: meta.color,
        summary: loc(meta.shortDescription, this.language),
        // The card is deliberately short. The full structure text, the fun fact and the related
        // links live on the Knowledge page; a card that carries everything pushed the action
        // buttons off screen and made the panel hard to dismiss with a pinch.
        sections: [{ title: copy.function, items: locList(meta.function, this.language).slice(0, 3) }],
        buttons: [
          {
            id: 'isolate',
            label: this.cell.isolation === id ? copy.undo : copy.isolate,
            icon: 'focus',
            onClick: () => this.toggleIsolation(id)
          },
          {
            id: 'undo',
            label: copy.undo,
            icon: 'arrowLeft',
            onClick: () => this.unselect()
          },
          {
            id: 'open-knowledge',
            label: copy.openKnowledge,
            icon: 'network',
            primary: true,
            onClick: () => this.ctx.actions.openKnowledge(id)
          }
        ]
      },
      this.anchorFor(id)
    );
  }

  /** Isolate the selected part (hide the rest), or undo the isolation. */
  private toggleIsolation(id: OrganelleId): void {
    const isolating = this.cell.isolation !== id;
    this.cell.setIsolation(isolating ? id : null);
    // Re-render so the button reflects the new state instead of silently doing nothing visible.
    this.openOverlay(id);
  }

  private anchorFor(id: OrganelleId): { x: number; y: number } | null {
    const camera = this.ctx.scene.camera;
    camera.updateMatrixWorld();
    // Projected radius from view-space depth, as in `pick()`: one projection per anchor
    // instead of two, and no allocation on the 17 Hz anchor refresh.
    const tanHalfFov = Math.tan((camera.fov * 0.5 * Math.PI) / 180) / camera.zoom;
    const halfViewport = this.ctx.scene.viewportHeight * 0.5;
    const invViewMatrix = camera.matrixWorldInverse;
    const own: Array<{ x: number; y: number; radius: number }> = [];
    for (const candidate of this.cell.pickCandidates()) {
      if (candidate.id !== id) continue;
      const projected = this.ctx.scene.projectToScreen(candidate.center);
      if (!projected.visible) continue;
      const depth = Math.max(
        0.05,
        -this.viewScratch.copy(candidate.center).applyMatrix4(invViewMatrix).z
      );
      own.push({
        x: projected.x,
        y: projected.y,
        radius: (candidate.radius * halfViewport) / (depth * tanHalfFov)
      });
    }
    if (!own.length) {
      this.cell.root.updateWorldMatrix(true, false);
      const world = this.cell.root.localToWorld(this.cell.getCenter(id));
      const projected = this.ctx.scene.projectToScreen(world);
      return projected.visible ? { x: projected.x, y: projected.y } : null;
    }

    /*
     * Pick one instance and keep following it. Choosing "the largest projected instance" every
     * frame makes a label or a selection-test ring jump to a different vacuole/Golgi stack when
     * the cell rotates, which then records a huge aim error. The previous screen position is the
     * best hint for which instance the user is looking at; only fall back to the largest instance
     * when that one has moved off screen or the part was re-entered.
     */
    const previous = this.anchorMemory.get(id);
    let best: { x: number; y: number; radius: number } | null = null;
    if (previous) {
      let nearest = Infinity;
      for (const candidate of own) {
        const d = Math.hypot(candidate.x - previous.x, candidate.y - previous.y);
        if (d < nearest && d <= 180) {
          nearest = d;
          best = candidate;
        }
      }
    }
    if (!best) {
      for (const candidate of own) if (!best || candidate.radius > best.radius) best = candidate;
    }
    if (!best) best = own[0];
    this.anchorMemory.set(id, { x: best.x, y: best.y });
    return { x: best.x, y: best.y };
  }

  /** Public projection helper (screenshots + gesture replay). */
  screenPosition(id: OrganelleId): { x: number; y: number } | null {
    return this.anchorFor(id);
  }

  // ------------------------------------------------------------ selection test

  private static readonly TEST_IDS: OrganelleId[] = [
    'nucleus',
    'mitochondrion',
    'golgi',
    'rough-er',
    'smooth-er',
    'lysosome',
    'vacuole',
    'centriole',
    'peroxisome',
    'nucleolus'
  ];

  toggleSelectionTest(): void {
    if (this.test) this.stopSelectionTest();
    else this.startSelectionTest();
  }

  startSelectionTest(restart = false): void {
    if (this.test && !this.test.complete && !restart) {
      this.stopSelectionTest();
      return;
    }
    this.stopSelectionTest();
    this.savedAutoRotate = this.autoRotate;
    this.autoRotate = false;
    this.pausedUntil = Number.POSITIVE_INFINITY;
    this.inertia.set(0, 0);
    this.anchorMemory.clear();
    this.unselect();
    this.test = {
      ids: [...InteractiveLabPage.TEST_IDS],
      index: 0,
      attempts: 0,
      hits: 0,
      errors: [],
      results: [],
      complete: false
    };
    this.testBusy = false;
    this.testPanel.hidden = false;
    this.advanceSelectionTest();
  }

  stopSelectionTest(): void {
    this.test = null;
    this.testBusy = false;
    this.testTarget = null;
    this.anchorMemory.clear();
    this.cell.setTestTarget(null);
    this.testPanel.hidden = true;
    this.testMarker.hidden = true;
    this.autoRotate = this.savedAutoRotate;
    if (this.pausedUntil === Number.POSITIVE_INFINITY) this.pausedUntil = 0;
  }

  selectionTestState(): Record<string, unknown> {
    if (!this.test) return { active: false };
    const rate = this.test.attempts ? this.test.hits / this.test.attempts : 0;
    const mean = this.test.errors.length
      ? this.test.errors.reduce((a, b) => a + b, 0) / this.test.errors.length
      : 0;
    return {
      active: !this.test.complete,
      complete: this.test.complete,
      target: this.currentTestTarget(),
      index: this.test.index,
      total: this.test.ids.length,
      attempts: this.test.attempts,
      hits: this.test.hits,
      hitRate: Number(rate.toFixed(3)),
      meanAimErrorPx: Number(mean.toFixed(1)),
      results: this.test.results
    };
  }

  /** Diagnostics hook for the pinch-start halo pulse (e2e feedback test). */
  selectionFlashState(): { id: string; remainingMs: number } | null {
    return this.cell.flashState();
  }

  private currentTestTarget(): OrganelleId | null {
    return this.test && !this.test.complete ? this.test.ids[this.test.index] ?? null : null;
  }

  private advanceSelectionTest(): void {
    if (!this.test) return;
    if (this.test.index >= this.test.ids.length) {
      this.test.complete = true;
      this.testTarget = null;
      this.cell.setTestTarget(null);
      this.testMarker.hidden = true;
      this.updateTestPanel();
      return;
    }
    this.testTarget = this.test.ids[this.test.index];
    this.cell.setTestTarget(this.testTarget);
    this.testBusy = false;
    this.updateTestPanel();
  }

  private recordSelectionAttempt(hit: boolean, aim?: { x: number; y: number }): void {
    if (!this.test || this.test.complete || this.testBusy) return;
    const target = this.test.ids[this.test.index];
    if (!target) return;
    const point = this.screenPosition(target);
    const errorPx = aim && point ? Math.hypot(aim.x - point.x, aim.y - point.y) : null;
    this.test.attempts++;
    if (hit) this.test.hits++;
    if (errorPx !== null && Number.isFinite(errorPx)) this.test.errors.push(errorPx);
    this.test.results.push({ target, hit, errorPx });
    this.testBusy = true;
    this.updateTestPanel();
    window.setTimeout(() => {
      if (!this.test) return;
      this.test.index++;
      this.advanceSelectionTest();
    }, 440);
  }

  private updateTestPanel(): void {
    if (!this.test) return;
    const copy = this.language === 'fr' ? 'Pincez :' : 'Pinch:';
    const target = this.currentTestTarget();
    const name = target ? loc(ORGANELLE_BY_ID.get(target)?.name, this.language) : '';
    const targetNode = this.testPanel.querySelector('.lab-test-target');
    if (targetNode) {
      targetNode.textContent = this.test.complete
        ? this.language === 'fr'
          ? 'Terminé'
          : 'Complete'
        : `${copy} ${name}`;
    }
    const bar = this.testPanel.querySelector('.lab-test-bar > i') as HTMLElement | null;
    if (bar) bar.style.width = `${(this.test.attempts / this.test.ids.length) * 100}%`;
    const rate = this.test.attempts ? (this.test.hits / this.test.attempts) * 100 : 0;
    const mean = this.test.errors.length
      ? this.test.errors.reduce((a, b) => a + b, 0) / this.test.errors.length
      : 0;
    const stats = this.testPanel.querySelector('.lab-test-stats');
    if (stats) {
      stats.textContent = `${this.test.hits} / ${this.test.attempts} · ${rate.toFixed(0)}% · ${mean.toFixed(1)} px`;
    }
    const list = this.testPanel.querySelector('.lab-test-list');
    if (list) {
      list.innerHTML = this.test.results
        .slice()
        .reverse()
        .slice(0, 8)
        .map((r) => {
          const label = loc(ORGANELLE_BY_ID.get(r.target)?.name, this.language);
          return `<div class="${r.hit ? 'is-hit' : 'is-miss'}"><b>${r.hit ? '✓' : '✕'}</b> ${escapeHtml(label)} <small>${r.errorPx === null ? '—' : `${r.errorPx.toFixed(0)} px`}</small></div>`;
        })
        .join('');
    }
  }

  private syncRail(): void {
    for (const [id, chip] of this.chips) {
      chip.classList.toggle('is-active', id === this.selected);
      chip.classList.toggle('is-hover', id === this.hovered);
    }
  }

  private updateHint(): void {
    const copy = COPY[this.language];
    const text = this.hint.querySelector('span');
    if (text) {
      if (this.mode === 'hands') {
        text.textContent = this.selected ? copy.hintSelected : copy.hintIdle;
      } else {
        text.textContent = this.selected ? copy.pointerHintSelected : copy.pointerHintIdle;
      }
    }
    this.hint.classList.toggle('is-selected', !!this.selected);
  }

  // -------------------------------------------------------------------- intents

  onIntent(intent: Intent): void {
    if (this.test && !this.test.complete) {
      if (intent.type === 'select') {
        this.recordSelectionAttempt(intent.id === this.testTarget, intent.aim);
        return;
      }
      if (intent.type === 'unselect') {
        this.recordSelectionAttempt(false, intent.aim);
        return;
      }
      if (intent.type === 'rotate' || intent.type === 'scale') return;
    }
    switch (intent.type) {
      case 'select':
        // With the card open, a pinch that lands on the cell rather than on a control is a
        // request to dismiss, not to select something else. The close button sits near
        // selectable parts, so without this a near-miss selected a new organelle instead of
        // closing the panel.
        if (this.selected) {
          this.unselect();
          break;
        }
        // Instant pinch commits get a short halo pulse so the user sees the selection land
        // before the isolate tween and the overlay take over (audit UX-005).
        if (intent.pinchStart) this.cell.flashSelection(intent.id as OrganelleId);
        this.select(intent.id as OrganelleId);
        break;
      case 'unselect':
        this.unselect();
        break;
      case 'rotate':
        this.rotateHeld = true;
        this.pausedUntil = performance.now() + 2600;
        // Anchor on the first frame of the gesture, then track the palm absolutely (see update()).
        if (!this.rotateAnchor && intent.palm) {
          this.rotateAnchor = {
            startX: intent.palm.x,
            startY: intent.palm.y,
            palmX: intent.palm.x,
            palmY: intent.palm.y,
            rotY: this.rig.rotation.y,
            rotX: this.rig.rotation.x
          };
        }
        if (this.rotateAnchor && intent.palm) {
          this.rotateAnchor.palmX = intent.palm.x;
          this.rotateAnchor.palmY = intent.palm.y;
        }
        // No inertia kick: it fought the absolute target and made the cell coast past the hand.
        this.inertia.set(0, 0);
        break;
      case 'scale': {
        if (this.lastGesture !== 'SCALING') this.scaleBase = this.zoom.scale.x;
        this.zoom.scale.setScalar(clamp(this.scaleBase * intent.factor, 0.55, 2.6));
        break;
      }
      case 'state':
        this.lastGesture = intent.state;
        // The gesture ended (pinch released, hand lost, or a two-hand scale took over): commit
        // any un-eased target from the current anchor, then drop it so the next gesture starts
        // from wherever the rig now is.
        if (intent.state !== 'ROTATING' && this.rotateAnchor) {
          const vw = Math.max(1, window.innerWidth);
          const vh = Math.max(1, window.innerHeight);
          const dx = clamp((this.rotateAnchor.palmX - this.rotateAnchor.startX) / vw, -0.5, 0.5);
          const dy = clamp((this.rotateAnchor.palmY - this.rotateAnchor.startY) / vh, -0.5, 0.5);
          this.rig.rotation.y = this.rotateAnchor.rotY + dx * ROTATE_GAIN;
          this.rig.rotation.x = clamp(this.rotateAnchor.rotX + dy * ROTATE_GAIN, -0.9, 0.9);
          this.rotateAnchor = null;
        }
        break;
      default:
        break;
    }
  }

  pick(x: number, y: number, options?: PickOptions): string | null {
    const base = options?.radiusPx ?? 48;
    const camera = this.ctx.scene.camera;
    camera.updateMatrixWorld();
    // Projected radius of a sphere from its view-space depth, instead of a second
    // `projectToScreen` per anchor. Same value as projecting centre + radius, half the work,
    // and no allocation in the per-pointer-frame loop.
    const tanHalfFov = Math.tan((camera.fov * 0.5 * Math.PI) / 180) / camera.zoom;
    const halfViewport = this.ctx.scene.viewportHeight * 0.5;
    const invViewMatrix = camera.matrixWorldInverse;
    const candidates: Array<{ id: string; x: number; y: number; radiusPx: number }> = [];
    for (const part of this.cell.pickCandidates()) {
      const p = this.ctx.scene.projectToScreen(part.center);
      if (!p.visible) continue;
      const depth = Math.max(0.05, -this.viewScratch.copy(part.center).applyMatrix4(invViewMatrix).z);
      const projectedRadius = (part.radius * halfViewport) / (depth * tanHalfFov);
      candidates.push({
        id: part.id,
        x: p.x,
        y: p.y,
        radiusPx: Math.min(84, Math.max(16, projectedRadius))
      });
    }

    // Screen-space instance proximity first. It resolves overlapping transparent structures by
    // asking which organelle centre the hand is nearest to, rather than which surface happens to
    // be frontmost in the depth buffer.
    const near = nearestWithin({ x, y }, candidates, base);
    if (near) return near.id;

    // Exact ray hit is the fallback for long, thin structures whose representative centre may sit
    // outside the proximity radius.
    return this.cell.pick(this.ctx.scene.rayFromPixels(x, y));
  }

  setHovered(id: string | null): void {
    const next = (id as OrganelleId | null) ?? null;
    if (next === this.hovered) return;
    this.hovered = next && this.cell.parts.has(next) ? next : null;
    this.cell.setHovered(this.hovered);
    this.syncRail();
  }

  // --------------------------------------------------------------------- update

  update(dt: number, elapsed: number): void {
    this.tweens.update(dt * 1000);
    this.cell.update(dt, elapsed);

    if (this.test && !this.test.complete && this.testTarget) {
      const p = this.screenPosition(this.testTarget);
      if (p) {
        this.testMarker.hidden = false;
        this.testMarker.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
        const label = this.testMarker.querySelector('b');
        if (label) label.textContent = loc(ORGANELLE_BY_ID.get(this.testTarget)?.name, this.language);
      } else {
        this.testMarker.hidden = true;
      }
    } else {
      this.testMarker.hidden = true;
    }

    const now = performance.now();
    if (
      !this.reducedMotion &&
      this.autoRotate &&
      !this.selected &&
      now > this.pausedUntil &&
      !this.rotateHeld
    ) {
      this.rig.rotation.y += dt * 0.12;
    }

    /*
     * Rotation is absolute, not accumulated. The palm position at the start of the gesture is
     * anchored to the rig's rotation at that moment, and the rig eases toward
     * anchor + (palm - anchorPalm) * gain. Accumulating per-detection deltas made the cell
     * integrate every jitter of the palm estimate — the middle-finger knuckle moves as the
     * fingers curl into a pinch — so the direction flipped frame to frame and the motion looked
     * robotic. An absolute target cannot drift, cannot reverse on noise, and follows the hand.
     */
    if (this.rotateAnchor) {
      // `intent.palm` is in CSS pixels, so the delta is normalised by the viewport before the
      // gain is applied. Skipping that step multiplied a 12 px frame delta by 3.2 and spun the
      // rig tens of radians per frame.
      const vw = Math.max(1, window.innerWidth);
      const vh = Math.max(1, window.innerHeight);
      // A single frame that claims more than half the screen is a bad detection, not a hand.
      const dx = clamp((this.rotateAnchor.palmX - this.rotateAnchor.startX) / vw, -0.5, 0.5);
      const dy = clamp((this.rotateAnchor.palmY - this.rotateAnchor.startY) / vh, -0.5, 0.5);
      const targetY = this.rotateAnchor.rotY + dx * ROTATE_GAIN;
      const targetX = clamp(this.rotateAnchor.rotX + dy * ROTATE_GAIN, -0.9, 0.9);
      const ease = 1 - Math.exp(-14 * dt);
      this.rig.rotation.y += (targetY - this.rig.rotation.y) * ease;
      this.rig.rotation.x += (targetX - this.rig.rotation.x) * ease;
    } else if (!this.reducedMotion) {
      this.rig.rotation.y += this.inertia.y * dt;
      this.rig.rotation.x = clamp(this.rig.rotation.x + this.inertia.x * dt, -0.9, 0.9);
      this.inertia.multiplyScalar(Math.exp(-3.2 * dt));
    }
    this.rotateHeld = false;

    this.rig.position.y = this.reducedMotion ? 0 : Math.sin(elapsed * 0.42) * 0.025;

    if (this.selected) {
      this.anchorClock += dt;
      if (this.anchorClock > 0.06) {
        this.anchorClock = 0;
        this.ctx.overlay.update(this.anchorFor(this.selected));
      }
    }
  }

  dispose(): void {
    this.stopSelectionTest();
    this.ctx.scene.labGroup.remove(this.rig);
    this.cell.dispose();
    this.tweens.clear();
    this.ctx.overlay.hide();
    this.root.remove();
  }
}
