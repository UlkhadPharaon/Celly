import type { Intent, Language, PageId, Settings } from '../types';
import type { SceneManager } from '../scene/sceneManager';
import type { ButtonRegistry } from '../ui/buttons';
import type { Overlay } from '../ui/overlay';
import type { Shell } from '../ui/shell';

export interface PageActions {
  openLab: (organelleId: string) => void;
  openKnowledge: (nodeId: string) => void;
  openTest: (nodeId?: string) => void;
  toast: (message: string, tone?: 'info' | 'success' | 'warn') => void;
}

export interface PageContext {
  scene: SceneManager;
  registry: ButtonRegistry;
  overlay: Overlay;
  shell: Shell;
  settings: Settings;
  actions: PageActions;
}

export interface Page {
  readonly id: PageId;
  readonly root: HTMLElement;
  enter(): void;
  exit(): void;
  update(dt: number, elapsed: number): void;
  onIntent(intent: Intent): void;
  pick(x: number, y: number): string | null;
  setHovered(id: string | null): void;
  setLanguage(language: Language): void;
  setAutoRotate?(value: boolean): void;
  closeOverlay(): void;
  dispose(): void;
}

export interface PageHeaderCopy {
  eyebrow: string;
  title: string;
  lead: string;
}

export function pageHeader(copy: PageHeaderCopy): HTMLElement {
  const header = document.createElement('header');
  header.className = 'page-intro';
  header.innerHTML = `
    <span class="eyebrow">${copy.eyebrow}</span>
    <h1>${copy.title}</h1>
    <p>${copy.lead}</p>
  `;
  return header;
}
