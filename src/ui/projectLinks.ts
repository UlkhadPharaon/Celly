import type { ButtonRegistry } from './buttons';
import { ICONS, svgIcon } from './dom';

/**
 * Canonical public links. Keeping them in one module makes the header, the control panel and the
 * onboarding card agree, and gives future surfaces a single source of truth.
 */
export const PROJECT_LINKS = {
  live: 'https://celly-blue.vercel.app/',
  github: 'https://github.com/UlkhadPharaon/Celly',
  article:
    'https://medium.com/@ulrichtapsoba2009/from-rgb-camera-to-3d-interaction-how-controller-free-xr-could-transform-learning-d920d92cf5ba'
} as const;

export type ProjectLinkKind = 'github' | 'article';

export interface ProjectLinkOptions {
  kind: ProjectLinkKind;
  label: string;
  newTabLabel: string;
  /** Header variant: icon only, same footprint as the other top-bar icon buttons. */
  compact?: boolean;
}

export function createProjectLink(options: ProjectLinkOptions): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = options.compact ? 'project-link project-link--compact' : 'project-link';
  link.href = PROJECT_LINKS[options.kind];
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.dataset.projectLink = options.kind;

  const icon = svgIcon(ICONS[options.kind]);
  icon.classList.add('project-link-icon');
  const label = document.createElement('span');
  label.className = 'project-link-label';
  const external = svgIcon(ICONS.external);
  external.classList.add('project-link-external');
  link.append(icon, label, external);

  updateProjectLink(link, options.label, options.newTabLabel);
  return link;
}

/** Refresh the visible and accessible label after a language switch. */
export function updateProjectLink(link: HTMLAnchorElement, label: string, newTabLabel: string): void {
  const labelNode = link.querySelector('.project-link-label');
  if (labelNode) labelNode.textContent = label;
  const accessible = `${label} — ${newTabLabel}`;
  link.setAttribute('aria-label', accessible);
  link.title = accessible;
}

/**
 * Register an anchor for pinch selection. Native pointer clicks keep the browser's default anchor
 * behaviour and its `target="_blank"` guarantee; gestures cannot rely on user activation, so they
 * try a new tab and fall back to a same-tab navigation if the popup is refused.
 */
export function registerProjectLink(
  registry: ButtonRegistry,
  id: string,
  link: HTMLAnchorElement
): () => void {
  return registry.register(id, link, () => {
    const opened = window.open(link.href, '_blank');
    if (!opened) {
      window.location.assign(link.href);
      return;
    }
    opened.opener = null;
    opened.focus();
  });
}
