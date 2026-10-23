import type { Language, PageId } from '../types';
import { svgIcon, ICONS } from './dom';
import type { ButtonRegistry } from './buttons';

const TABS: Array<{ id: PageId; en: string; fr: string; icon: keyof typeof ICONS }> = [
  { id: 'interactive', en: 'Interactive', fr: 'Laboratoire', icon: 'lab' },
  { id: 'knowledge', en: 'Knowledge', fr: 'Savoirs', icon: 'network' },
  { id: 'test', en: 'Test', fr: 'Test', icon: 'test' }
];

export class Tabs {
  readonly root: HTMLElement;
  private readonly buttons = new Map<PageId, HTMLButtonElement>();

  constructor(
    private readonly registry: ButtonRegistry,
    private readonly onSelect: (page: PageId) => void,
    language: Language = 'en'
  ) {
    this.root = document.createElement('nav');
    this.root.className = 'tabs';
    this.root.setAttribute('aria-label', 'Sections');

    for (const tab of TABS) {
      const btn = document.createElement('button');
      btn.className = 'tab';
      btn.type = 'button';
      btn.dataset.page = tab.id;
      btn.setAttribute('aria-label', language === 'fr' ? tab.fr : tab.en);
      btn.append(svgIcon(ICONS[tab.icon]));
      const label = document.createElement('span');
      label.textContent = language === 'fr' ? tab.fr : tab.en;
      btn.append(label);
      btn.addEventListener('click', () => this.onSelect(tab.id));
      this.registry.register(`tab:${tab.id}`, btn, () => this.onSelect(tab.id));
      this.root.append(btn);
      this.buttons.set(tab.id, btn);
    }
  }

  setActive(page: PageId): void {
    for (const [id, btn] of this.buttons) {
      const active = id === page;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-current', active ? 'page' : 'false');
    }
  }

  setLanguage(language: Language): void {
    for (const tab of TABS) {
      const btn = this.buttons.get(tab.id);
      if (!btn) continue;
      const label = btn.querySelector('span');
      if (label) label.textContent = language === 'fr' ? tab.fr : tab.en;
      btn.setAttribute('aria-label', language === 'fr' ? tab.fr : tab.en);
    }
  }
}
