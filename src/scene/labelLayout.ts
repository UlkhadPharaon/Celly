/**
 * Screen-space label layout for the knowledge graph (audit task 2.3).
 *
 * Billboards can only be culled or moved, so this pass does both: high-priority labels keep their
 * spot, lower-priority ones are pushed out of the way in small screen-space steps, and a label is
 * hidden only when no nearby slot is free. When the full-size layout loses enough labels, very
 * long labels switch to an abbreviation ("Golgi apparatus" -> "GA") and the pass is repeated.
 *
 * Pure and renderer-free so the behaviour is unit-testable; the scene converts the returned
 * viewport-fraction offsets into world-space sprite offsets.
 */

export interface LabelBox {
  id: string;
  /** Centre of the unpushed label in viewport fractions (0..1, y grows downwards). */
  cx: number;
  cy: number;
  /** Label width in viewport fractions for the full and abbreviated variants. */
  fullWidth: number;
  shortWidth: number;
  height: number;
  /** 0 = hovered, 1 = focused, 2 = neighbour, 3 = background. Lower wins. */
  prio: number;
  canShorten: boolean;
}

export interface LabelPlacement {
  id: string;
  visible: boolean;
  /** Push-out in viewport fractions; positive x is right, positive y is down. */
  dx: number;
  dy: number;
  /** The abbreviated texture should be used. */
  short: boolean;
}

export interface LabelLayoutConfig {
  /** Extra padding around each box, viewport fractions. */
  gapX: number;
  gapY: number;
  /** Step size and reach of the push-out search. */
  stepX: number;
  stepY: number;
  maxShiftX: number;
  maxShiftY: number;
  /** Keep pushed labels this far inside the viewport. */
  margin: number;
  /** Abbreviate only when the full-size layout loses more labels than this. */
  maxHiddenFull: number;
}

export const LABEL_LAYOUT: LabelLayoutConfig = {
  gapX: 0.012,
  gapY: 0.006,
  stepX: 0.02,
  stepY: 0.016,
  maxShiftX: 0.08,
  maxShiftY: 0.1,
  margin: 0.004,
  maxHiddenFull: 2
};

/** Multi-word labels at least this long get an initials form. */
const ABBREVIATE_AT = 10;

/** "Golgi apparatus" -> "GA"; labels that are already short keep their name. */
export function shortenLabel(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || text.length < ABBREVIATE_AT) return text;
  const initials = words.map((word) => word[0]?.toUpperCase() ?? '').join('');
  return initials.length >= 2 ? initials : text;
}

interface Spot {
  cx: number;
  cy: number;
  dx: number;
  dy: number;
  w: number;
  h: number;
}

function overlaps(a: Spot, b: Spot, cfg: LabelLayoutConfig): boolean {
  return (
    Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 + cfg.gapX &&
    Math.abs(a.cy - b.cy) < (a.h + b.h) / 2 + cfg.gapY
  );
}

/** Up/down first, then sideways, then diagonals — nearest push wins. */
function pushOffsets(cfg: LabelLayoutConfig): Array<{ dx: number; dy: number }> {
  const offsets: Array<{ dx: number; dy: number }> = [];
  const xSteps = Math.max(1, Math.round(cfg.maxShiftX / cfg.stepX));
  const ySteps = Math.max(1, Math.round(cfg.maxShiftY / cfg.stepY));
  for (let ring = 1; ring <= Math.max(xSteps, ySteps); ring++) {
    const dy = ring * cfg.stepY;
    const dx = ring * cfg.stepX;
    if (dy <= cfg.maxShiftY + 1e-9) offsets.push({ dx: 0, dy: -dy }, { dx: 0, dy });
    if (dx <= cfg.maxShiftX + 1e-9) offsets.push({ dx: -dx, dy: 0 }, { dx, dy: 0 });
    if (dx <= cfg.maxShiftX + 1e-9 && dy <= cfg.maxShiftY + 1e-9) {
      offsets.push({ dx: -dx, dy: -dy }, { dx, dy: -dy }, { dx: -dx, dy }, { dx, dy });
    }
  }
  return offsets;
}

function insideViewport(spot: Spot, cfg: LabelLayoutConfig): boolean {
  return (
    spot.cx - spot.w / 2 >= cfg.margin &&
    spot.cx + spot.w / 2 <= 1 - cfg.margin &&
    spot.cy - spot.h / 2 >= cfg.margin &&
    spot.cy + spot.h / 2 <= 1 - cfg.margin
  );
}

function place(
  boxes: readonly LabelBox[],
  shortIds: ReadonlySet<string>,
  cfg: LabelLayoutConfig
): Map<string, LabelPlacement> {
  const kept: Spot[] = [];
  const placements = new Map<string, LabelPlacement>();
  const offsets = pushOffsets(cfg);

  for (const box of boxes) {
    const short = shortIds.has(box.id);
    const w = short ? box.shortWidth : box.fullWidth;
    const h = box.height;
    const home: Spot = { cx: box.cx, cy: box.cy, dx: 0, dy: 0, w, h };

    let spot: Spot | null = null;
    if (!kept.some((other) => overlaps(home, other, cfg))) {
      spot = home;
    } else {
      for (const offset of offsets) {
        const candidate: Spot = {
          cx: box.cx + offset.dx,
          cy: box.cy + offset.dy,
          dx: offset.dx,
          dy: offset.dy,
          w,
          h
        };
        if (!insideViewport(candidate, cfg)) continue;
        if (kept.some((other) => overlaps(candidate, other, cfg))) continue;
        spot = candidate;
        break;
      }
    }

    if (!spot) {
      placements.set(box.id, { id: box.id, visible: false, dx: 0, dy: 0, short });
      continue;
    }
    kept.push(spot);
    placements.set(box.id, {
      id: box.id,
      visible: true,
      dx: spot.dx,
      dy: spot.dy,
      short
    });
  }

  return placements;
}

/**
 * Lay out `boxes` in the order given (the caller sorts by priority, importance and distance).
 * When full-size text loses more than `maxHiddenFull` labels, retry with every background label
 * that has an abbreviation. Abbreviating only the lost labels would leave the wide labels that
 * crowded them in place, so the whole non-priority tier switches to its compact form.
 */
export function layoutLabels(
  boxes: readonly LabelBox[],
  cfg: LabelLayoutConfig = LABEL_LAYOUT
): Map<string, LabelPlacement> {
  const empty = new Set<string>();
  const full = place(boxes, empty, cfg);

  const hiddenFull = [...full.values()].filter((placement) => !placement.visible).length;
  if (hiddenFull <= cfg.maxHiddenFull) return full;

  const compact = boxes.filter((box) => box.canShorten && box.prio >= 2);
  if (!compact.length) return full;

  return place(boxes, new Set(compact.map((box) => box.id)), cfg);
}
