import type { HandFrame } from '../types';
import type { PinchEvent } from '../gestures/gestureEngine';
import { el } from './dom';

export interface DebugSnapshot {
  page: string | null;
  frames: HandFrame[];
  primary: HandFrame | null;
  pickRadius: number;
  armed: string | null;
  uiHover: string | null;
  pinchLog: PinchEvent[];
  rig: Record<string, unknown> | null;
}

/**
 * Screen-space hand-selection debug view. It intentionally lives above the WebGL canvas so the
 * raw cursor, filtered cursor and frozen aim can be compared without adding more geometry to the
 * scene. The yellow landmark overlay itself is drawn inside the hand rig.
 */
export class DebugOverlay {
  readonly root: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly readout: HTMLElement;
  private readonly log: HTMLElement;
  private readonly title: HTMLElement;

  constructor() {
    this.root = el('div', 'celly-debug');
    this.root.hidden = true;
    this.root.innerHTML = `
      <svg class="celly-debug__svg" aria-hidden="true"></svg>
      <div class="celly-debug__panel">
        <div class="celly-debug__head">
          <strong>Hand selection debug</strong>
          <span class="celly-debug__keys">D toggle · T selection test</span>
        </div>
        <div class="celly-debug__readout"></div>
        <div class="celly-debug__legend">
          <span><i style="background:#ff9f43"></i>raw</span>
          <span><i style="background:#4cc9f0"></i>filtered</span>
          <span><i style="background:#b8ff6a"></i>locked aim</span>
          <span><i style="background:#ffd166"></i>pick radius</span>
        </div>
        <div class="celly-debug__log"></div>
      </div>
    `;
    this.svg = this.root.querySelector('.celly-debug__svg') as SVGSVGElement;
    this.readout = this.root.querySelector('.celly-debug__readout') as HTMLElement;
    this.log = this.root.querySelector('.celly-debug__log') as HTMLElement;
    this.title = this.root.querySelector('.celly-debug__head strong') as HTMLElement;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  toggle(force?: boolean): boolean {
    const currentlyHidden = this.root.hidden !== false;
    const next = force ?? currentlyHidden;
    this.root.hidden = !next;
    return next;
  }

  update(snapshot: DebugSnapshot): void {
    if (this.root.hidden) return;
    this.title.textContent = `Hand selection debug · ${snapshot.page ?? '—'}`;
    const p = snapshot.primary;
    const rig = snapshot.rig;
    const angle = rig?.['angleErrorDeg'];
    const skin = rig?.['skin'] as Array<Record<string, unknown>> | undefined;
    const skinText = skin?.length
      ? skin
          .map(
            (s) =>
              `${s['mesh']}: ${s['vertices']} v, unweighted ${s['unweighted']}, sum ${s['weightSumMin']}–${s['weightSumMax']}`
          )
          .join('<br>')
      : '—';

    this.readout.innerHTML = `
      <div><b>page</b> ${escapeHtml(snapshot.page ?? '—')} <b>armed</b> ${escapeHtml(snapshot.armed ?? '—')} <b>ui</b> ${escapeHtml(snapshot.uiHover ?? '—')}</div>
      <div><b>side</b> ${p?.side ?? '—'} <b>pinch</b> ${p ? p.pinchValue.toFixed(2) : '—'} <b>span</b> ${p ? p.handSpan.toFixed(3) : '—'} <b>radius</b> ${Math.round(snapshot.pickRadius)} px</div>
      <div><b>raw</b> ${p ? `${Math.round(p.rawCursor.x)}, ${Math.round(p.rawCursor.y)}` : '—'} <b>filtered</b> ${p ? `${Math.round(p.cursor.x)}, ${Math.round(p.cursor.y)}` : '—'} <b>aim</b> ${p ? `${Math.round(p.aim.x)}, ${Math.round(p.aim.y)}` : '—'} ${p?.aimLocked ? '<em>locked</em>' : ''}</div>
      <div><b>angle error</b> ${typeof angle === 'number' ? `${angle.toFixed(2)}°` : '—'} <b>primitives</b> ${rig ? 'rig' : '—'}</div>
      <div class="celly-debug__skin">${skinText}</div>
    `;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const nodes: string[] = [];
    for (const frame of snapshot.frames) {
      if (!frame.present) continue;
      nodes.push(circle(frame.rawCursor.x, frame.rawCursor.y, 5, '#ff9f43', 'raw'));
      nodes.push(circle(frame.cursor.x, frame.cursor.y, 4, '#4cc9f0', 'filtered'));
      if (frame.aimLocked) nodes.push(circle(frame.aim.x, frame.aim.y, 7, '#b8ff6a', 'aim'));
    }
    if (p) {
      nodes.push(circle(p.aim.x, p.aim.y, snapshot.pickRadius, '#ffd166', 'pick', true));
      if (snapshot.armed) {
        nodes.push(
          `<text x="${clamp(p.aim.x + snapshot.pickRadius + 8, 8, w - 220)}" y="${clamp(p.aim.y - 8, 18, h - 8)}" fill="#ffd166" font-size="12">${escapeHtml(snapshot.armed)}</text>`
        );
      }
    }
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.svg.innerHTML = nodes.join('');

    this.log.innerHTML = snapshot.pinchLog.length
      ? snapshot.pinchLog
          .slice()
          .reverse()
          .map(
            (e) =>
              `<div><span>${e.result}</span> ${escapeHtml(e.target ?? 'blank')} <small>${e.reason} · ${Math.round(e.heldMs)} ms · ${Math.round(e.travelPx)} px</small></div>`
          )
          .join('')
      : '<div class="celly-debug__empty">No pinch events yet</div>';
  }
}

function circle(x: number, y: number, r: number, color: string, label: string, ring = false): string {
  const fill = ring ? 'none' : color;
  const stroke = ring ? color : 'rgba(0,0,0,.45)';
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${ring ? 1.5 : 1}" opacity="${ring ? 0.8 : 0.95}"><title>${label}</title></circle>`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
