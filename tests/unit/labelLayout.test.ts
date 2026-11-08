import { describe, expect, it } from 'vitest';
import {
  LABEL_LAYOUT,
  layoutLabels,
  shortenLabel,
  type LabelBox,
  type LabelLayoutConfig
} from '../../src/scene/labelLayout';

function box(partial: Partial<LabelBox> & Pick<LabelBox, 'id'>): LabelBox {
  return {
    cx: 0.5,
    cy: 0.5,
    fullWidth: 0.2,
    shortWidth: 0.2,
    height: 0.03,
    prio: 3,
    canShorten: false,
    ...partial
  };
}

/** Same collision rule the layout uses, so the test asserts the contract, not the algorithm. */
interface Placed {
  cx: number;
  cy: number;
  dx: number;
  dy: number;
  height: number;
  w: number;
}

function overlaps(a: Placed, b: Placed): boolean {
  return (
    Math.abs(a.cx + a.dx - (b.cx + b.dx)) < (a.w + b.w) / 2 + LABEL_LAYOUT.gapX &&
    Math.abs(a.cy + a.dy - (b.cy + b.dy)) < (a.height + b.height) / 2 + LABEL_LAYOUT.gapY
  );
}

describe('knowledge label layout (task 2.3)', () => {
  it('keeps the higher-priority label at home and pushes the lower one clear', () => {
    const boxes = [
      box({ id: 'hovered', prio: 0 }),
      box({ id: 'other', prio: 3 })
    ];
    const placements = layoutLabels(boxes);

    expect(placements.get('hovered')).toMatchObject({ visible: true, dx: 0, dy: 0, short: false });
    const pushed = placements.get('other')!;
    expect(pushed.visible).toBe(true);
    // Push-out prefers vertical movement and must actually clear the higher-priority box.
    expect(pushed.dy).toBeLessThan(0);
    const a = { ...boxes[0], dx: placements.get('hovered')!.dx, dy: placements.get('hovered')!.dy, w: boxes[0].fullWidth };
    const b = { ...boxes[1], dx: pushed.dx, dy: pushed.dy, w: boxes[1].fullWidth };
    expect(overlaps(a, b)).toBe(false);
  });

  it('hides a label when no nearby free slot exists', () => {
    const tight: LabelLayoutConfig = { ...LABEL_LAYOUT, maxShiftX: 0.01, maxShiftY: 0.01, stepX: 0.01, stepY: 0.01 };
    const boxes = [box({ id: 'a', prio: 0 }), box({ id: 'b', prio: 1 })];
    const placements = layoutLabels(boxes, tight);

    expect(placements.get('a')!.visible).toBe(true);
    expect(placements.get('b')!.visible).toBe(false);
  });

  it('abbreviates pressured labels only once full-size text has lost several labels', () => {
    const dense: LabelLayoutConfig = { ...LABEL_LAYOUT, maxShiftX: 0.01, maxShiftY: 0.01, stepX: 0.01, stepY: 0.01 };
    // Four labels on one row, wide at full size and narrow when abbreviated.
    const boxes = ['a', 'b', 'c', 'd'].map((id, index) =>
      box({
        id,
        cx: 0.4 + index * 0.05,
        fullWidth: 0.2,
        shortWidth: 0.03,
        canShorten: true
      })
    );
    const placements = layoutLabels(boxes, dense);

    // Three of four full-size labels would be lost, so the pass retries abbreviated.
    for (const boxDef of boxes) {
      const placement = placements.get(boxDef.id)!;
      expect(placement.visible).toBe(true);
      expect(placement.short).toBe(true);
    }
    const placed = boxes.map((b) => ({ ...b, ...placements.get(b.id)!, w: b.shortWidth }));
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlaps(placed[i], placed[j]), `${placed[i].id} overlaps ${placed[j].id}`).toBe(false);
      }
    }
  });

  it('never abbreviates the hovered or focused label', () => {
    const dense: LabelLayoutConfig = { ...LABEL_LAYOUT, maxShiftX: 0.01, maxShiftY: 0.01, stepX: 0.01, stepY: 0.01 };
    const boxes = [
      box({ id: 'hovered', prio: 0, canShorten: true, shortWidth: 0.03, cx: 0.4 }),
      box({ id: 'focused', prio: 1, canShorten: true, shortWidth: 0.03, cx: 0.43 }),
      box({ id: 'a', prio: 3, canShorten: true, shortWidth: 0.03, cx: 0.46 }),
      box({ id: 'b', prio: 3, canShorten: true, shortWidth: 0.03, cx: 0.49 }),
      box({ id: 'c', prio: 3, canShorten: true, shortWidth: 0.03, cx: 0.52 })
    ];
    const placements = layoutLabels(boxes, dense);

    expect(placements.get('hovered')!.short).toBe(false);
    expect(placements.get('focused')!.short).toBe(false);
    expect([...placements.values()].some((placement) => placement.short)).toBe(true);
  });

  it('shortens only long multi-word labels, and leaves short forms alone', () => {
    expect(shortenLabel('Golgi apparatus')).toBe('GA');
    expect(shortenLabel('Cellular respiration')).toBe('CR');
    expect(shortenLabel('Protein synthesis')).toBe('PS');
    expect(shortenLabel('Active transport')).toBe('AT');
    expect(shortenLabel('Rough ER')).toBe('Rough ER');
    expect(shortenLabel('Nucleus')).toBe('Nucleus');
    expect(shortenLabel('ATP')).toBe('ATP');
  });
});
