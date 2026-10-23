import type { HandSide, Vec3 } from '../types';
import { dist3 } from '../core/math';

export interface SideDetection {
  /** Raw MediaPipe category name. */
  label: 'Left' | 'Right' | 'Unknown';
  wrist: Vec3;
  score: number;
}

export interface SideOptions {
  /** Manual user correction from the control panel. */
  handsSwap: boolean;
}

interface Slot {
  side: HandSide;
  wrist: Vec3;
  lastSeen: number;
  pending: HandSide | null;
  pendingSince: number;
}

const FLIP: Record<'Left' | 'Right', HandSide> = { Left: 'right', Right: 'left' };
const LOST_MS = 450;
const SWITCH_MS = 150;
const MATCH_DIST = 0.4;

/**
 * Resolves which of the user's hands is Left/Right.
 *
 * MediaPipe's handedness assumes a *mirrored* (selfie) input image. The tracker feeds it the
 * raw camera frame, so the label is flipped once. `handsSwap` is the user's manual correction.
 * Assignments are debounced per tracking slot (nearest wrist) so the label never flickers L↔R.
 */
export class HandSideResolver {
  private slots: Slot[] = [];

  resolve(detections: SideDetection[], opts: SideOptions, tMs: number): HandSide[] {
    const raw = detections.map((d) => this.rawSide(d.label, opts.handsSwap));

    // Drop stale slots.
    this.slots = this.slots.filter((s) => tMs - s.lastSeen < LOST_MS);

    const used = new Set<Slot>();
    const result: HandSide[] = new Array(detections.length);
    const match: Array<Slot | null> = new Array(detections.length).fill(null);

    // Greedy nearest-wrist matching.
    const pairs: Array<{ i: number; slot: Slot; d: number }> = [];
    detections.forEach((det, i) => {
      for (const slot of this.slots) {
        const d = dist3(det.wrist, slot.wrist);
        if (d < MATCH_DIST) pairs.push({ i, slot, d });
      }
    });
    pairs.sort((a, b) => a.d - b.d);
    for (const p of pairs) {
      if (match[p.i] || used.has(p.slot)) continue;
      match[p.i] = p.slot;
      used.add(p.slot);
    }

    detections.forEach((det, i) => {
      const slot = match[i];
      if (!slot) {
        const s: Slot = {
          side: raw[i],
          wrist: det.wrist,
          lastSeen: tMs,
          pending: null,
          pendingSince: 0
        };
        this.slots.push(s);
        used.add(s);
        match[i] = s;
        result[i] = s.side;
        return;
      }
      slot.wrist = det.wrist;
      slot.lastSeen = tMs;

      if (raw[i] === slot.side) {
        slot.pending = null;
        slot.pendingSince = 0;
      } else {
        if (slot.pending !== raw[i]) {
          slot.pending = raw[i];
          slot.pendingSince = tMs;
        } else if (tMs - slot.pendingSince >= SWITCH_MS) {
          slot.side = raw[i];
          slot.pending = null;
          slot.pendingSince = 0;
        }
      }
      result[i] = slot.side;
    });

    // A slot index repeated means MediaPipe saw two hands with the same label — force the
    // second one to the opposite side so the UI never shows two "left" hands.
    if (result.length === 2 && result[0] === result[1]) {
      result[1] = result[0] === 'left' ? 'right' : 'left';
    }
    return result;
  }

  private rawSide(label: 'Left' | 'Right' | 'Unknown', swap: boolean): HandSide {
    if (label === 'Unknown') return 'right';
    const anatomical = FLIP[label];
    if (!swap) return anatomical;
    return anatomical === 'left' ? 'right' : 'left';
  }

  reset(): void {
    this.slots = [];
  }
}
