import { expect, type Page, test } from '@playwright/test';

/**
 * Knowledge-graph label collisions (audit task 2.3). The scene culls labels, pushes lower
 * priorities clear of higher ones and abbreviates on dense frames. This drives the real scene and
 * checks the laid-out boxes: visible labels must not cover each other, and crowding must be
 * resolved by movement rather than by hiding everything.
 */

interface LabelBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
  short: boolean;
  pushed: boolean;
}

async function enterKnowledge(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__celly);
  await page.click('[data-celly="mouse"]');
  await page.click('[data-celly="next"]');
  await page.click('[data-celly="enter"]');
  await expect(page.locator('.page-lab')).toBeVisible();
  await page.keyboard.press('2');
  await expect(page.locator('.page-knowledge')).toBeVisible();
}

function overlaps(a: LabelBox, b: LabelBox): number {
  const x = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const y = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return x > 0 && y > 0 ? x * y : 0;
}

test('visible knowledge labels never cover each other', async ({ page }) => {
  await enterKnowledge(page);
  await expect
    .poll(() => page.evaluate(() => window.__celly!.knowledgeLabels().filter((b) => b.visible).length), {
      timeout: 30_000
    })
    .toBeGreaterThan(8);

  const boxes = await page.evaluate(() => window.__celly!.knowledgeLabels());
  const visible = boxes.filter((box) => box.visible);
  expect(visible.length).toBeGreaterThan(8);

  const collisions: string[] = [];
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const area = overlaps(visible[i], visible[j]);
      // Rounding between the layout's viewport fractions and CSS pixels is sub-pixel; anything
      // larger is a real collision the user would see.
      if (area > 4) collisions.push(`${visible[i].id} / ${visible[j].id} (${area.toFixed(1)} px²)`);
    }
  }
  expect(collisions, `overlapping labels: ${collisions.join(', ')}`).toEqual([]);

  // The pass resolves crowding by moving labels, not only by hiding them.
  expect(boxes.some((box) => box.visible && box.pushed)).toBe(true);

  // And dense frames use abbreviations for the background tier.
  expect(boxes.some((box) => box.visible && box.short)).toBe(true);
});
