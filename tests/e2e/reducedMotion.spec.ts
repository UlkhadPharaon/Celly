import { expect, type Page, test } from '@playwright/test';

/**
 * Reduce-motion enforcement (audit task 3.1). Before this change the toggle only slowed the
 * scene clock and disabled CSS animations: the cell kept auto-rotating, the dust kept drifting,
 * ambient pulses kept pulsing and camera/page transitions kept tweening. This drives the real
 * control and asserts each subsystem stops within the rendered frames.
 */

interface MotionState {
  reducedMotion: boolean;
  rigRotationY: number;
  dustClock: number;
  transitioning: boolean;
}

async function enterLab(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__celly);
  await page.click('[data-celly="mouse"]');
  await page.click('[data-celly="next"]');
  await page.click('[data-celly="enter"]');
  await expect(page.locator('.page-lab')).toBeVisible();
}

async function waitFrames(page: Page, count: number): Promise<void> {
  const start = await page.evaluate(() => window.__celly!.renderedFrames);
  await page.waitForFunction(
    ([s, n]) => window.__celly!.renderedFrames >= s + n,
    [start, count],
    { timeout: 30_000 }
  );
}

function motion(page: Page): Promise<MotionState> {
  return page.evaluate(() => window.__celly!.motionState() as MotionState);
}

test('reduce motion freezes auto-rotation and dust and snaps camera transitions', async ({
  page
}) => {
  await enterLab(page);

  // Baseline: the lab rig is auto-rotating, so its Y rotation advances between frames.
  const before = await motion(page);
  await waitFrames(page, 3);
  const moving = await motion(page);
  expect(Math.abs(moving.rigRotationY - before.rigRotationY)).toBeGreaterThan(0.003);

  // Turn the preference on from the control panel.
  await page.click('.controls-more > summary');
  await page.click('.switch[data-toggle="reducedMotion"]');
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');

  const still = await motion(page);
  expect(still.reducedMotion).toBe(true);

  // Four more real frames: neither the rig nor the dust clock may move.
  await waitFrames(page, 4);
  const after = await motion(page);
  expect(after.reducedMotion).toBe(true);
  expect(after.rigRotationY).toBe(still.rigRotationY);
  expect(after.dustClock).toBe(still.dustClock);

  // Camera transitions snap: a section switch leaves nothing in flight. (With motion on the
  // 780 ms camera tween would still be running after several software-WebGL frames.)
  await page.click('.tabs .tab[data-page="knowledge"]');
  await expect(page.locator('.page-knowledge')).toBeVisible();
  await waitFrames(page, 1);
  expect((await motion(page)).transitioning).toBe(false);
});
