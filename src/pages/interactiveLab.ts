import * as THREE from 'three';
import type { GestureState, Intent, Language } from '../types';
import type { OrganelleId } from '../scene/types';
import { CellModel } from '../scene/cellModel';
import { ORGANELLES, ORGANELLE_BY_ID, loc, locList } from '../data/catalog';
import { Tweens, ease } from '../core/tween';
import { clamp } from '../core/math';
import { type Page, type PageContext, pageHeader } from './page';

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
  private language: Language;
  private readonly labels = new Map<string, HTMLElement>();
  private readonly chips = new Map<string, HTMLElement>();
  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly lead: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly indexLabel: HTMLElement;

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
    this.cell.root.updateWorldMatrix(true, false);
    const world = this.cell.root.localToWorld(this.cell.getCenter(id));
    const projected = this.ctx.scene.projectToScreen(world);
    if (!projected.visible) return null;
    return { x: projected.x, y: projected.y };
  }

  /** Public projection helper (screenshots + gesture replay). */
  screenPosition(id: OrganelleId): { x: number; y: number } | null {
    return this.anchorFor(id);
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

  pick(x: number, y: number): string | null {
    const raycaster = this.ctx.scene.rayFromPixels(x, y);
    return this.cell.pick(raycaster);
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
    this.ctx.scene.labGroup.remove(this.rig);
    this.cell.dispose();
    this.tweens.clear();
    this.ctx.overlay.hide();
    this.root.remove();
  }
}
