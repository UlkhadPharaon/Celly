export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function svgIcon(path: string, viewBox = '0 0 24 24'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  svg.innerHTML = path;
  return svg;
}

export const ICONS = {
  lab: '<circle cx="12" cy="12" r="3.2"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(35 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(-35 12 12)"/>',
  network: '<circle cx="12" cy="4.5" r="2"/><circle cx="4.8" cy="17" r="2"/><circle cx="19.2" cy="17" r="2"/><path d="M10.4 6.1 6.4 15.2M13.6 6.1l4 9.1M6.8 17h10.4"/>',
  test: '<path d="M9 11.5l2 2 4.5-4.8"/><rect x="3.5" y="4" width="17" height="16" rx="3"/>',
  hand: '<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5V5a1.5 1.5 0 0 1 3 0v6m0-4.5a1.5 1.5 0 0 1 3 0V12m0-3a1.5 1.5 0 0 1 3 0v5.2A6.8 6.8 0 0 1 13.2 21h-1.4A6.8 6.8 0 0 1 5 14.2V12a1.5 1.5 0 0 1 3 0"/>',
  rotate: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4.5V11h-6.5"/>',
  scale: '<path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6"/>',
  camera: '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="M16 10.5l5-2.8v8.6l-5-2.8"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.2 3.8M6.5 8.2A16 16 0 0 0 2.5 12S6 18 12 18a9.6 9.6 0 0 0 3.3-.6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  arrowLeft: '<path d="M14 6l-6 6 6 6"/>',
  arrowRight: '<path d="M10 6l6 6-6 6"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/>',
  flip: '<path d="M12 3v18"/><path d="M8 7 3.5 12 8 17M16 7l4.5 5-4.5 5"/>',
  swap: '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  cards: '<rect x="3.5" y="7" width="12" height="13" rx="2"/><path d="M8 3.5h9.5A2.5 2.5 0 0 1 20 6v10"/>',
  quiz: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.2 2.4c-.7.3-1 .9-1 1.7"/><path d="M11.9 16.8h.1"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.2 2.4c-.7.3-1 .9-1 1.7"/><path d="M11.9 16.8h.1"/>',
  privacy: '<path d="M12 3l7.5 3v5.4c0 4.5-3 8-7.5 9.6-4.5-1.6-7.5-5.1-7.5-9.6V6Z"/><path d="M9.3 12l1.9 1.9 3.6-3.9"/>',
  github:
    '<path fill="currentColor" stroke="none" d="M12 .8C5.7.8.6 5.9.6 12.2c0 5 3.3 9.3 7.8 10.8.6.1.8-.2.8-.6v-2.2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.1.1 1.7 1.2 1.7 1.2 1 1.7 2.7 1.2 3.4.9.1-.7.4-1.2.7-1.5-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.5-1.5 7.8-5.8 7.8-10.8C23.4 5.9 18.3.8 12 .8Z"/>',
  article: '<path d="M6 3.5h9l4 4v13H6Z"/><path d="M15 3.5v4h4"/><path d="M9 8.5h2.5M9 12h7M9 15.5h7"/>',
  external:
    '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5"/>'
} as const;
