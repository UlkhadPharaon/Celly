import { expect, type Page, test } from '@playwright/test';

/**
 * Pinch-start selection feedback (audit UX-005 / SPEC-04). Selection commits the moment the
 * pinch closes, which removes the old hold-time cue. These tests prove the app now plays a short
 * halo pulse on the committed organelle, and that the pulse ends.
 */

async function enterLab(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__celly);
  await page.click('[data-celly="mouse"]');
  await page.click('[data-celly="next"]');
  await page.click('[data-celly="enter"]');
  await expect(page.locator('.page-lab')).toBeVisible();
  await page.waitForTimeout(1200);
}

async function waitFrames(page: Page, count: number): Promise<void> {
  const start = await page.evaluate(() => window.__celly!.renderedFrames);
  await page.waitForFunction(
    ([s, n]) => window.__celly!.renderedFrames >= s + n,
    [start, count],
    { timeout: 20_000 }
  );
}

/** Hover an open hand at `id`'s projected anchor until the app arms it. */
async function arm(page: Page, id: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const anchor = await page.evaluate((node) => window.__celly!.sceneAnchor(node), id);
        if (!anchor) return null;
        await page.evaluate(
          ({ x, y }) => window.__celly!.injectHand('right', x, y, 0.1),
          anchor
        );
        await waitFrames(page, 1);
        return page.evaluate(() => window.__celly!.state.sceneHover);
      },
      { timeout: 30_000, intervals: [100, 250, 500] }
    )
    .toBe(id);
}

test('a pinch-start commit flashes the selected organelle', async ({ page }) => {
  await enterLab(page);
  const target = 'nucleus';
  await arm(page, target);

  // Close the pinch at the live anchor: the harness commits on this frame.
  await page.evaluate((node) => {
    const anchor = window.__celly!.sceneAnchor(node);
    if (anchor) window.__celly!.injectHand('right', anchor.x, anchor.y, 0.96);
  }, target);

  // The pulse starts on the commit tick. Poll quickly: it lasts ~150 ms of simulated time.
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(() => window.__celly!.selectionFlashState());
        return state ? state.id : null;
      },
      { timeout: 15_000, intervals: [10, 20, 50] }
    )
    .toBe(target);

  // The selection itself landed: the structure card opens.
  await expect(page.locator('.overlay-anchor.is-open')).toBeVisible();

  // And the acknowledgement is a pulse, not a permanent state change.
  await expect
    .poll(() => page.evaluate(() => window.__celly!.selectionFlashState()), { timeout: 15_000 })
    .toBeNull();

  // Release the pinch so the hand is left in a neutral state.
  await page.evaluate((node) => {
    const anchor = window.__celly!.sceneAnchor(node);
    if (anchor) window.__celly!.injectHand('right', anchor.x, anchor.y, 0.1);
  }, target);
});
