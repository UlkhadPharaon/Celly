import type { Intent, KnowledgeCategory, Language } from '../types';
import { KNOWLEDGE_NODES, KNOWLEDGE_BY_ID, loc, locList } from '../data/catalog';
import { KnowledgeScene } from '../scene/knowledgeScene';
import { clamp } from '../core/math';
import { type Page, type PageContext, pageHeader } from './page';

const COPY = {
  en: {
    eyebrow: 'Knowledge network',
    title: 'Everything connects',
    lead: 'Pinch a node to open it. Swipe to hop between linked ideas.',
    hint: 'Pinch a node · pinch and drag to swipe · left pinch to orbit',
    related: 'Linked ideas',
    facts: 'Key facts',
    openLab: 'Open in Lab',
    testMe: 'Test me',
    categories: {
      Organelles: 'Organelles',
      Molecules: 'Molecules',
      Processes: 'Processes',
      'Cell types': 'Cell types'
    } as Record<KnowledgeCategory, string>
  },
  fr: {
    eyebrow: 'Réseau de savoirs',
    title: 'Tout est lié',
    lead: 'Pincez un nœud pour l’ouvrir. Balayez pour passer d’une idée à l’autre.',
    hint: 'Pincez un nœud · pincez et glissez pour balayer · pincement gauche pour orbiter',
    related: 'Idées liées',
    facts: 'Points clés',
    openLab: 'Ouvrir au labo',
    testMe: 'Me tester',
    categories: {
      Organelles: 'Organites',
      Molecules: 'Molécules',
      Processes: 'Processus',
      'Cell types': 'Types de cellules'
    } as Record<KnowledgeCategory, string>
  }
};

const CATEGORY_COLORS: Record<KnowledgeCategory, string> = {
  Organelles: '#8b6cff',
  Molecules: '#7ee0c3',
  Processes: '#60a5fa',
  'Cell types': '#ec4899'
};

const CATEGORY_ORDER: KnowledgeCategory[] = ['Organelles', 'Molecules', 'Processes', 'Cell types'];

export class KnowledgePage implements Page {
  readonly id = 'knowledge' as const;
  readonly root: HTMLElement;

  private readonly knowledge: KnowledgeScene;
  private focused: string | null = null;
  private hovered: string | null = null;
  private scaleBase = 1;
  private lastGesture = 'IDLE';
  private anchorClock = 0;
  private swipeIndex = 0;
  private language: Language;
  private autoRotate = true;

  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly lead: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly keyRoot: HTMLElement;

  constructor(private readonly ctx: PageContext) {
    this.language = ctx.settings.language;
    this.knowledge = new KnowledgeScene(this.language);
    this.knowledge.autoRotate = true;
    // Leave room for the topbar, the HUD, the key and the overlay at 16:9.
    this.knowledge.root.scale.setScalar(1);
    ctx.scene.knowledgeGroup.add(this.knowledge.root);

    this.root = document.createElement('section');
    this.root.className = 'page page-knowledge';
    const header = pageHeader({ eyebrow: '', title: '', lead: '' });
    this.root.append(header);
    this.eyebrow = header.querySelector('.eyebrow') as HTMLElement;
    this.title = header.querySelector('h1') as HTMLElement;
    this.lead = header.querySelector('p') as HTMLElement;

    this.hint = document.createElement('div');
    this.hint.className = 'lab-hint knowledge-hint';
    this.hint.innerHTML = '<i class="live-dot"></i><span></span>';
    this.root.append(this.hint);

    this.keyRoot = document.createElement('div');
    this.keyRoot.className = 'knowledge-key';
    this.root.append(this.keyRoot);

    this.renderKey();
    this.setLanguage(this.language);
  }

  enter(): void {
    this.knowledge.root.visible = true;
    this.root.classList.add('is-active');
    this.ctx.overlay.hide();
    if (this.focused) this.openOverlay(this.focused);
    requestAnimationFrame(() => this.ctx.registry.refreshAll());
  }

  exit(): void {
    this.knowledge.root.visible = false;
    this.root.classList.remove('is-active');
    this.ctx.overlay.hide();
    this.unfocus();
  }

  setAutoRotate(value: boolean): void {
    this.autoRotate = value;
    this.knowledge.autoRotate = value;
  }

  setLanguage(language: Language): void {
    this.language = language;
    const copy = COPY[language];
    this.eyebrow.textContent = copy.eyebrow;
    this.title.textContent = copy.title;
    this.lead.textContent = copy.lead;
    const hint = this.hint.querySelector('span');
    if (hint) hint.textContent = copy.hint;
    this.knowledge.setLanguage(language);
    this.renderKey();
    if (this.focused) this.openOverlay(this.focused);
  }

  private renderKey(): void {
    const copy = COPY[this.language];
    this.keyRoot.innerHTML = '';
    for (const category of CATEGORY_ORDER) {
      const item = document.createElement('div');
      item.className = 'key-item';
      const dot = document.createElement('i');
      dot.style.background = CATEGORY_COLORS[category];
      const label = document.createElement('span');
      label.textContent = copy.categories[category];
      const count = document.createElement('b');
      count.textContent = String(KNOWLEDGE_NODES.filter((n) => n.category === category).length);
      item.append(dot, label, count);
      this.keyRoot.append(item);
    }
  }

  // --------------------------------------------------------------------- focus

  focusNode(id: string): void {
    if (!KNOWLEDGE_BY_ID.has(id)) return;
    this.focused = id;
    this.knowledge.focus(id);
    this.knowledge.setHover(null);
    this.hovered = null;
    this.openOverlay(id);
    this.swipeIndex = 0;
  }

  private unfocus(): void {
    if (!this.focused) return;
    this.focused = null;
    this.knowledge.unfocus();
    this.knowledge.autoRotate = this.autoRotate;
    this.ctx.overlay.hide();
  }

  closeOverlay(): void {
    this.unfocus();
  }

  private openOverlay(id: string): void {
    const node = KNOWLEDGE_BY_ID.get(id);
    if (!node) return;
    const copy = COPY[this.language];
    const links = this.knowledge.neighbours(id);
    this.ctx.overlay.show(
      {
        eyebrow: copy.categories[node.category],
        title: loc(node.label, this.language),
        accent: node.color,
        summary: loc(node.summary, this.language),
        sections: [{ title: copy.facts, items: locList(node.details, this.language) }],
        chipsLabel: copy.related,
        chips: links.slice(0, 6).map((lid) => {
          const linked = KNOWLEDGE_BY_ID.get(lid);
          return {
            id: lid,
            label: linked ? loc(linked.label, this.language) : lid,
            color: linked?.color,
            onClick: () => this.focusNode(lid)
          };
        }),
        buttons: [
          ...(node.organelleId
            ? [
                {
                  id: 'open-lab',
                  label: copy.openLab,
                  icon: 'lab' as const,
                  onClick: () => this.ctx.actions.openLab(node.organelleId as string)
                }
              ]
            : []),
          {
            id: 'test-me',
            label: copy.testMe,
            icon: 'quiz',
            primary: true,
            onClick: () => this.ctx.actions.openTest(node.id)
          }
        ]
      },
      this.anchorFor(id)
    );
  }

  private anchorFor(id: string): { x: number; y: number } | null {
    this.knowledge.root.updateMatrixWorld(true);
    const world = this.knowledge.worldPosition(id);
    const projected = this.ctx.scene.projectToScreen(world);
    if (!projected.visible) return null;
    return { x: projected.x, y: projected.y };
  }

  /** Public projection helper (screenshots + gesture replay). */
  screenPosition(id: string): { x: number; y: number } | null {
    return this.anchorFor(id);
  }

  // -------------------------------------------------------------------- intents

  onIntent(intent: Intent): void {
    switch (intent.type) {
      case 'select':
        this.focusNode(intent.id);
        break;
      case 'unselect':
        this.unfocus();
        break;
      case 'rotate':
        this.knowledge.root.rotation.y += intent.dx * 0.0032;
        this.knowledge.root.rotation.x = clamp(
          this.knowledge.root.rotation.x + intent.dy * 0.0032,
          -0.85,
          0.85
        );
        break;
      case 'scale':
        if (this.lastGesture !== 'SCALING') this.scaleBase = this.knowledge.root.scale.x;
        this.knowledge.root.scale.setScalar(clamp(this.scaleBase * intent.factor, 0.5, 1.85));
        break;
      case 'swipe':
        if (intent.phase === 'end' && Math.abs(intent.progress) > 0.7) this.hop(intent.progress > 0 ? 1 : -1);
        break;
      case 'state':
        this.lastGesture = intent.state;
        break;
      default:
        break;
    }
  }

  /** Move focus to a linked idea (or into the graph when nothing is focused). */
  private hop(direction: 1 | -1): void {
    if (this.focused) {
      const links = this.knowledge.neighbours(this.focused);
      if (!links.length) return;
      this.swipeIndex = (this.swipeIndex + direction + links.length) % links.length;
      this.focusNode(links[this.swipeIndex]);
      return;
    }
    const total = KNOWLEDGE_NODES.length;
    this.swipeIndex = (this.swipeIndex + direction + total) % total;
    this.focusNode(KNOWLEDGE_NODES[this.swipeIndex].id);
  }

  pick(x: number, y: number): string | null {
    return this.knowledge.pick(this.ctx.scene.rayFromPixels(x, y));
  }

  setHovered(id: string | null): void {
    if (id === this.hovered) return;
    this.hovered = id;
    this.knowledge.setHover(id);
  }

  // --------------------------------------------------------------------- update

  update(dt: number, elapsed: number): void {
    this.knowledge.update(dt, elapsed, this.ctx.scene.camera);
    if (this.focused) {
      this.anchorClock += dt;
      if (this.anchorClock > 0.06) {
        this.anchorClock = 0;
        this.ctx.overlay.update(this.anchorFor(this.focused));
      }
    }
  }

  dispose(): void {
    this.ctx.scene.knowledgeGroup.remove(this.knowledge.root);
    this.knowledge.dispose();
    this.ctx.overlay.hide();
    this.root.remove();
  }
}
