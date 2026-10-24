import * as THREE from 'three';
import type { GestureState, Intent, Language } from '../types';
import type { OrganelleId } from '../scene/types';
import { CellModel } from '../scene/cellModel';
import { ORGANELLES, ORGANELLE_BY_ID, loc, locList } from '../data/catalog';
import { Tweens, ease } from '../core/tween';
import { clamp } from '../core/math';
import { type Page, type PageContext, type PickOptions, pageHeader } from './page';
import { nearestWithin } from '../gestures/aim';

const COPY = {
  en: {
    eyebrow: 'Interactive lab',
    title: 'The animal cell',
    lead: 'Pinch a structure to isolate it. Pinch empty space to release.',
    hintIdle: 'Pinch a structure to explore',
    hintSelected: 'Pinch empty space to release · left pinch to rotate',
    index: 'Structures',
    organelle: 'Organelle',
    function: 'Function',
    structure: 'Structure',
    fact: 'Did you know',
    related: 'Related',
    openKnowledge: 'Open in Knowledge',
    prev: 'Previous structure',
    next: 'Next structure'
  },
  fr: {
    eyebrow: 'Laboratoire interactif',
    title: 'La cellule animale',
    lead: 'Pincez une structure pour l’isoler. Pincez le vide pour revenir.',
    hintIdle: 'Pincez une structure pour l’explorer',
    hintSelected: 'Pincez le vide pour relâcher · pincement gauche pour tourner',
    index: 'Structures',
    organelle: 'Organite',
    function: 'Fonction',
    structure: 'Structure',
    fact: 'Le saviez-vous',
    related: 'Lié à',
    openKnowledge: 'Ouvrir dans Savoirs',
    prev: 'Structure précédente',
    next: 'Structure suivante'
  }
};

const IDS = ORGANELLES.map((o) => o.id as OrganelleId);

export class InteractiveLabPage implements Page {
  readonly id = 'interactive' as const;
  readonly root: HTMLElement;

  private readonly rig = new THREE.Group();
  private readonly zoom = new THREE.Group();
  private readonly focus = new THREE.Group();
  private readonly cell = new CellModel();
  private readonly tweens = new Tweens();
  private readonly inertia = new THREE.Vector2();

  private selected: OrganelleId | null = null;
  private hovered: OrganelleId | null = null;
  private rotateHeld = false;
  private scaleBase = 1;
  private lastGesture: GestureState = 'IDLE';
  private pausedUntil = 0;
  private anchorClock = 0;
  private readonly anchorMemory = new Map<OrganelleId, { x: number; y: number }>();
  private language: Language;
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

  private autoRotate = true;

  setLanguage(language: Language): void {
    this.language = language;
    const copy = COPY[language];
    this.eyebrow.textContent = copy.eyebrow;
    this.title.textContent = copy.title;
    this.lead.textContent = copy.lead;
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

  private openOverlay(id: OrganelleId): void {
    const meta = ORGANELLE_BY_ID.get(id);
    if (!meta) return;
    const copy = COPY[this.language];
    const index = IDS.indexOf(id);
    const prev = IDS[(index - 1 + IDS.length) % IDS.length];
    const next = IDS[(index + 1) % IDS.length];

    this.ctx.overlay.show(
      {
        eyebrow: copy.organelle,
        title: loc(meta.name, this.language),
        accent: meta.color,
        summary: loc(meta.shortDescription, this.language),
        sections: [
          { title: copy.function, items: locList(meta.function, this.language) },
          { title: copy.structure, body: loc(meta.structure, this.language) },
          { title: copy.fact, body: loc(meta.funFact, this.language) }
        ],
        chipsLabel: copy.related,
        chips: meta.relatedIds
          .filter((rid) => ORGANELLE_BY_ID.has(rid))
          .map((rid) => {
            const related = ORGANELLE_BY_ID.get(rid);
            return {
              id: rid,
              label: related ? loc(related.name, this.language) : rid,
              color: related?.color,
              onClick: () => this.select(rid as OrganelleId)
            };
          }),
        buttons: [
          {
            id: 'prev',
            label: copy.prev,
            icon: 'arrowLeft',
            onClick: () => this.select(prev)
          },
          {
            id: 'next',
            label: copy.next,
            icon: 'arrowRight',
            onClick: () => this.select(next)
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

  private anchorFor(id: OrganelleId): { x: number; y: number } | null {
    const camera = this.ctx.scene.camera;
    camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const own: Array<{ x: number; y: number; radius: number }> = [];
    for (const candidate of this.cell.pickCandidates()) {
      if (candidate.id !== id) continue;
      const projected = this.ctx.scene.projectToScreen(candidate.center);
      if (!projected.visible) continue;
      const edge = this.ctx.scene.projectToScreen(
        candidate.center.clone().addScaledVector(right, candidate.radius)
      );
      own.push({
        x: projected.x,
        y: projected.y,
        radius: Math.hypot(edge.x - projected.x, edge.y - projected.y)
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
    if (text) text.textContent = this.selected ? copy.hintSelected : copy.hintIdle;
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
        this.select(intent.id as OrganelleId);
        break;
      case 'unselect':
        this.unselect();
        break;
      case 'rotate':
        this.rotateHeld = true;
        this.pausedUntil = performance.now() + 2600;
        this.rig.rotation.y += intent.dx * 0.0034;
        this.rig.rotation.x = clamp(this.rig.rotation.x + intent.dy * 0.0034, -0.9, 0.9);
        this.inertia.set(intent.dy * 0.28, intent.dx * 0.28);
        break;
      case 'scale': {
        if (this.lastGesture !== 'SCALING') this.scaleBase = this.zoom.scale.x;
        this.zoom.scale.setScalar(clamp(this.scaleBase * intent.factor, 0.55, 2.6));
        break;
      }
      case 'state':
        this.lastGesture = intent.state;
        break;
      default:
        break;
    }
  }

  pick(x: number, y: number, options?: PickOptions): string | null {
    const base = options?.radiusPx ?? 48;
    const camera = this.ctx.scene.camera;
    camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const candidates: Array<{ id: string; x: number; y: number; radiusPx: number }> = [];
    for (const part of this.cell.pickCandidates()) {
      const p = this.ctx.scene.projectToScreen(part.center);
      if (!p.visible) continue;
      const edge = this.ctx.scene.projectToScreen(part.center.clone().addScaledVector(right, part.radius));
      const projectedRadius = Math.hypot(edge.x - p.x, edge.y - p.y);
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
    if (this.autoRotate && !this.selected && now > this.pausedUntil && !this.rotateHeld) {
      this.rig.rotation.y += dt * 0.12;
    }
    if (!this.rotateHeld) {
      this.rig.rotation.y += this.inertia.y * dt;
      this.rig.rotation.x = clamp(this.rig.rotation.x + this.inertia.x * dt, -0.9, 0.9);
      this.inertia.multiplyScalar(Math.exp(-3.2 * dt));
    }
    this.rotateHeld = false;

    this.rig.position.y = Math.sin(elapsed * 0.42) * 0.025;

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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
