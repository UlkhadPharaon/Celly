import { expect, type Page, test } from '@playwright/test';

/**
 * Universal hand activation.
 *
 * The registry covers the controls that were registered, but the mouse can also press native
 * markup the registry never saw (the selection-test panel, HUD actions, links added later). A
 * pinch must resolve those through `document.elementFromPoint` and fire the same click a mouse
 * would. This spec uses the selection-test close button, which is deliberately not registered.
 */

async function enterWithMouse(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__celly);
  await page.click('[data-celly="mouse"]');
  await page.click('[data-celly="next"]');
  await page.click('[data-celly="enter"]');
  await expect(page.locator('.page-lab')).toBeVisible();
  await page.waitForTimeout(1200);
}

test('an unregistered native button is hovered and clicked by the hand', async ({ page }) => {
  await enterWithMouse(page);
  await page.keyboard.press('t');
  await expect(page.locator('.lab-test-panel')).toBeVisible();

  const close = page.locator('[data-test="close"]');
  const box = await close.boundingBox();
  expect(box, 'close button has no layout box').not.toBeNull();
  const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };

  // Hover: the registry never registered this element, so `is-hover` can only come from the
  // elementFromPoint fallback.
  await page.evaluate((p) => window.__celly!.injectHand('right', p.x, p.y, 0.1), point);
  await expect.poll(() => close.evaluate((el) => el.classList.contains('is-hover')), {
    timeout: 20_000
  }).toBe(true);

  // Close: aim, pinch past the enter threshold, release. UI clicks keep release semantics, so
  // the pinch frame must actually be rendered before the release replaces it.
  await page.evaluate((p) => window.__celly!.injectHand('right', p.x, p.y, 0.96), point);
  const before = await page.evaluate(() => window.__celly!.renderedFrames);
  await page.waitForFunction(
    (start) => window.__celly!.renderedFrames > start,
    before,
    { timeout: 20_000 }
  );
  await page.evaluate((p) => window.__celly!.injectHand('right', p.x, p.y, 0.1), point);
  await expect(page.locator('.lab-test-panel')).toBeHidden({ timeout: 20_000 });

  // The click really ran the button's own listener rather than just changing a class.
  await expect(page.evaluate(() => window.__celly!.selectionTestState().active)).resolves.toBe(false);
});
