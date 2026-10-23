import { expect, type Page, test } from '@playwright/test';

async function enterWithMouse(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__celly);
  await page.click('[data-celly="mouse"]');
  await page.click('[data-celly="next"]');
  await page.click('[data-celly="enter"]');
  await expect(page.locator('.page-lab')).toBeVisible();
  await page.waitForTimeout(1200);
}

/** Move the synthetic hand, settle, then pinch and hold long enough to pass the 70 ms hold. */
async function pinchAt(page: Page, x: number, y: number, side: 'left' | 'right' = 'right'): Promise<void> {
  await page.evaluate(
    ([s, px, py]) => window.__celly!.injectHand(s as 'left' | 'right', px as number, py as number, 0.1),
    [side, x, y]
  );
  await page.waitForTimeout(180);
  await page.evaluate(
    ([s, px, py]) => window.__celly!.injectHand(s as 'left' | 'right', px as number, py as number, 0.96),
    [side, x, y]
  );
  await page.waitForTimeout(420);
}

/**
 * The cell auto-rotates and the knowledge graph eases into frame, so a single anchor read goes
 * stale. Re-aim until the hover lands on the element, then return the id and the anchor that
 * worked. Because an organelle can sit behind another one, callers can offer a list of
 * candidates and the first genuinely hoverable one wins.
 */
async function aimAt(page: Page, ids: string[]): Promise<{ id: string; x: number; y: number }> {
  let found: { id: string; x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        for (const id of ids) {
          const anchor = await page.evaluate((node) => window.__celly!.sceneAnchor(node), id);
          if (!anchor) continue;
          await page.evaluate(({ x, y }) => window.__celly!.injectHand('right', x, y, 0.1), anchor);
          await page.waitForTimeout(110);
          const hover = await page.evaluate(() => window.__celly!.state.sceneHover);
          if (hover === id) {
            found = { id, ...anchor };
            return id;
          }
        }
        return null;
      },
      { timeout: 12_000 }
    )
    .not.toBeNull();
  return found!;
}

async function selectHovered(page: Page, ids: string[]): Promise<string> {
  const target = await aimAt(page, ids);
  // Re-read the anchor and pinch in the same task so the graph cannot drift out from under us.
  await page.evaluate((id) => {
    const anchor = window.__celly!.sceneAnchor(id);
    if (anchor) window.__celly!.injectHand('right', anchor.x, anchor.y, 0.96);
  }, target.id);
  await page.waitForTimeout(520);
  return target.id;
}

/** "rough-er" -> /Rough/i, used to prove the overlay shows the organelle we picked. */
function titlePattern(id: string): RegExp {
  const first = id.split('-')[0];
  return new RegExp(`^${first[0].toUpperCase()}${first.slice(1)}`, 'i');
}

/** The floating card must never cover the HUD rail or the control panel. */
async function expectOverlayClearOfChrome(page: Page): Promise<void> {
  const overlay = await page.locator('.overlay-anchor.is-open').boundingBox();
  expect(overlay).not.toBeNull();
  const chrome = await page.locator('.left-rail, .controls').evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })
  );
  for (const box of chrome) {
    const overlapX = Math.max(
      0,
      Math.min(overlay!.x + overlay!.width, box.x + box.width) - Math.max(overlay!.x, box.x)
    );
    const overlapY = Math.max(
      0,
      Math.min(overlay!.y + overlay!.height, box.y + box.height) - Math.max(overlay!.y, box.y)
    );
    expect(overlapX * overlapY, 'overlay overlaps fixed chrome').toBe(0);
  }
}

test.describe('synthetic hand replay', () => {
  test('tracks a hand, selects an organelle and releases it', async ({ page }) => {
    await enterWithMouse(page);
    // Freeze the cell so the organelle does not drift between the anchor read and the pinch.
    await page.click('.auto-rotate');
    await expect(page.locator('.auto-rotate')).toHaveAttribute('data-on', 'false');
    await page.waitForTimeout(600);

    const picked = await selectHovered(page, [
      'mitochondrion',
      'golgi',
      'lysosome',
      'vacuole',
      'peroxisome',
      'centriole',
      'smooth-er',
      'rough-er',
      'ribosome',
      'nucleolus',
      'nucleus'
    ]);
    await expect(page.locator('.hud')).toContainText('1 hand');
    await expect(page.locator('.overlay-anchor.is-open')).toBeVisible();
    await expectOverlayClearOfChrome(page);
    await expect(page.locator('.overlay-anchor.is-open h2')).toContainText(titlePattern(picked));

    // The 3D hand is anchored on its pinch point, so the fingertips sit on the cursor.
    const debug = await page.evaluate(() => window.__celly!.debugHand('right'));
    expect(debug.present).toBe(true);

    await pinchAt(page, 90, 880);
    await expect(page.locator('.overlay-anchor')).not.toHaveClass(/is-open/);

    await page.evaluate(() => window.__celly!.clearInjectedHands());
    await expect.poll(() => page.evaluate(() => window.__celly!.state.hands)).toBe(0);
    await expect(page.locator('.hud')).toContainText('No hands');
  });

  test('opens a knowledge node and releases it', async ({ page }) => {
    await enterWithMouse(page);
    await page.click('.tabs .tab[data-page="knowledge"]');
    await expect(page.locator('.page-knowledge')).toBeVisible();
    // Let the camera tween finish before trusting any projected anchor.
    await page.waitForTimeout(2600);

    const picked = await selectHovered(page, ['golgi', 'nucleus', 'ribosome']);
    await expect(page.locator('.overlay-anchor.is-open')).toBeVisible();
    await expectOverlayClearOfChrome(page);
    await expect(page.locator('.overlay-anchor.is-open h2')).toContainText(titlePattern(picked));

    await pinchAt(page, 40, 830);
    await expect(page.locator('.overlay-anchor')).not.toHaveClass(/is-open/);
  });

  test('shows both hands and the scale state', async ({ page }) => {
    await enterWithMouse(page);
    await page.evaluate(() => {
      window.__celly!.injectHand('right', 1180, 460, 0.96);
      window.__celly!.injectHand('left', 380, 640, 0.96);
    });
    await expect.poll(() => page.evaluate(() => window.__celly!.state.hands)).toBe(2);
    await expect(page.locator('.hud')).toContainText('2 hands');
    await expect(page.locator('.hud')).toContainText('scaling');

    await page.evaluate(() => window.__celly!.clearInjectedHands());
    await expect.poll(() => page.evaluate(() => window.__celly!.state.hands)).toBe(0);
  });
});
