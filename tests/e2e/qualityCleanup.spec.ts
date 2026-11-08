import { expect, type Page, test } from '@playwright/test';

/**
 * Quality-toggle resource cleanup (audit W-06 / SPEC-05). Switching modes rebuilds the
 * post-processing chain, so the old composer's read/write targets, the bloom pass targets and
 * the shadow map must all be released. `renderer.info.memory` is the observable proof: it counts
 * live GPU textures/geometries, so a forgotten disposal shows up as monotonic growth.
 */

type RenderStats = {
  quality: 'high' | 'low';
  dpr: number;
  geometries: number;
  textures: number;
  shadows: boolean;
  bloom: boolean;
};

async function enterLab(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__celly);
  await page.click('[data-celly="mouse"]');
  await page.click('[data-celly="next"]');
  await page.click('[data-celly="enter"]');
  await expect(page.locator('.page-lab')).toBeVisible();
  await page.waitForTimeout(1200);
}

async function stats(page: Page): Promise<RenderStats> {
  return page.evaluate(() => window.__celly!.renderStats as RenderStats);
}

async function setQuality(page: Page, quality: 'high' | 'low'): Promise<void> {
  await page.click(`[data-quality="${quality}"]`);
  await expect.poll(async () => (await stats(page)).quality, { timeout: 20_000 }).toBe(quality);
  // Let at least one frame with the new chain render before counting allocations.
  const start = await page.evaluate(() => window.__celly!.renderedFrames);
  await page.waitForFunction(
    ([s, n]) => window.__celly!.renderedFrames >= s + n,
    [start, 2],
    { timeout: 20_000 }
  );
}

test('quality toggles release their render targets and shadow map', async ({ page }) => {
  await enterLab(page);

  // Feature flags follow the mode (this project runs the desktop profile: shadows and bloom
  // are available at high quality and off at low).
  await setQuality(page, 'low');
  const fast = await stats(page);
  expect(fast.quality).toBe('low');
  expect(fast.shadows).toBe(false);
  expect(fast.bloom).toBe(false);

  await setQuality(page, 'high');
  const high = await stats(page);
  expect(high.quality).toBe('high');
  expect(high.bloom).toBe(true);
  expect(high.shadows).toBe(true);

  // One full cycle has now allocated everything the high path needs; additional cycles must
  // return to the same live counts instead of accumulating a composer per toggle.
  await setQuality(page, 'low');
  await setQuality(page, 'high');
  const baseline = await stats(page);

  for (let cycle = 0; cycle < 3; cycle++) {
    await setQuality(page, 'low');
    await setQuality(page, 'high');
  }
  const after = await stats(page);

  expect(after.textures, 'GPU textures grew across quality cycles').toBeLessThanOrEqual(
    baseline.textures + 2
  );
  expect(after.geometries, 'GPU geometries grew across quality cycles').toBeLessThanOrEqual(
    baseline.geometries + 2
  );
  // The scene is still healthy after the rebuilds.
  expect((await stats(page)).textures).toBeGreaterThan(0);
});
