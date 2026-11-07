import { expect, type Page, test } from '@playwright/test';

/**
 * The hand model runs in a dedicated worker, off the render thread. These tests start the real
 * camera path (Playwright's fake device supplies the video) and assert the worker pipeline
 * reaches a live delegate, produces detections, and never blocks the main thread the way
 * synchronous inference did.
 *
 * Frame-rate assertions are deliberately absent: this harness renders WebGL in software, so the
 * scene itself is the bottleneck regardless of where inference runs. What is asserted here is the
 * invariant that made Celly stutter — that the main thread stays free while inference is measured
 * inside the worker.
 */

interface TrackingSnapshot {
  camera: string;
  tracking: string;
  detail: string | null;
  trackerFps: number;
  inferenceMs: number;
  ready: boolean;
}

async function enterWithCamera(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__celly);
  // The onboarding step that asks for the camera auto-grants on the fake UI.
  await page.click('[data-celly="enable"]', { timeout: 20_000 }).catch(() => undefined);
  await page.click('[data-celly="next"]', { timeout: 20_000 }).catch(() => undefined);
  await page.click('[data-celly="enter"]', { timeout: 20_000 }).catch(() => undefined);
  await expect(page.locator('.page-lab')).toBeVisible();
}

async function trackingState(page: Page): Promise<TrackingSnapshot> {
  return page.evaluate(() => window.__celly!.trackingState());
}

/** Records the longest main-thread task while the callback runs. */
async function measureLongTask(page: Page, windowMs: number): Promise<number> {
  return page.evaluate(async (duration) => {
    let longest = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longest = Math.max(longest, entry.duration);
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
    await new Promise((resolve) => setTimeout(resolve, duration));
    observer.disconnect();
    return longest;
  }, windowMs);
}

test('starts hand inference in a background worker and keeps the render loop free', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await enterWithCamera(page);

  // The worker reports its delegate once the model is loaded inside it.
  await page.waitForFunction(
    () => ['gpu', 'cpu', 'error'].includes(window.__celly!.trackingState().tracking),
    null,
    { timeout: 90_000 }
  );
  const state = await trackingState(page);
  expect(state.camera).toBe('live');
  expect(state.tracking).not.toBe('error');
  expect(state.ready).toBe(true);
  expect(state.detail).toContain('worker');

  // Inference actually ran inside the worker: only the worker measures its own call duration.
  await page.waitForFunction(() => window.__celly!.trackingState().inferenceMs > 0, null, {
    timeout: 90_000
  });
  const after = await trackingState(page);
  expect(after.inferenceMs).toBeGreaterThan(0);

  // While inference runs, the render loop keeps producing frames. Synchronous inference used to
  // eat 5.7 s of every 6 s window, which left almost no frames at all.
  const renderProbe = await page.evaluate(async () => {
    const start = window.__celly!.renderedFrames;
    const clockStart = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    return {
      frames: window.__celly!.renderedFrames - start,
      elapsedMs: performance.now() - clockStart
    };
  });
  expect(renderProbe.frames).toBeGreaterThan(0);

  // No single main-thread task lasts as long as one inference call: the inference itself must be
  // happening off-thread, not blocking the loop that is driving the camera pump.
  const longestTask = await measureLongTask(page, 2500);
  expect(longestTask).toBeLessThan(after.inferenceMs);

  expect(consoleErrors.join('\n')).not.toContain('ModuleFactory');
  expect(consoleErrors.join('\n')).not.toContain('pageerror');
});
