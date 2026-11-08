import { expect, type Page, test } from '@playwright/test';

/**
 * Camera-lifecycle retry test (audit CELLY-BUG-004).
 *
 * The project harness grants the camera through `--use-fake-ui-for-media-stream`. This spec
 * overrides the launch args so the permission prompt is left undecided (Playwright never grants
 * it), which exercises the failure path: the tracker must settle on a terminal state — via the
 * browser's denial or its own 12 s request timeout — instead of staying on 'requesting', and a
 * retry must issue a fresh camera request rather than being blocked by a one-way flag.
 */
test.use({
  launchOptions: {
    args: [
      // No --use-fake-ui-for-media-stream: the harness never auto-grants the camera.
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--enable-unsafe-swiftshader'
    ]
  }
});

const TERMINAL_STATES = ['denied', 'timeout', 'not-found', 'in-use', 'unsupported', 'insecure-context'];

async function openOnboarding(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__celly);
  // boot() opens the onboarding card ~520 ms after mount.
  await expect(page.locator('.onboarding')).toBeVisible({ timeout: 20_000 });
}

async function cameraState(page: Page): Promise<string> {
  return page.evaluate(() => window.__celly!.trackingState().camera);
}

test('a failed camera request settles and can be retried without deadlocking', async ({ page }) => {
  await openOnboarding(page);

  // Fresh session: no camera request has been made through the UI path yet.
  expect(await page.evaluate(() => window.__celly!.cameraAttempts)).toBe(0);

  await page.click('[data-celly="enable"]');

  // The failure settles on a terminal status — never a stuck 'requesting'.
  await page.waitForFunction(
    (terminal) => terminal.includes(window.__celly!.trackingState().camera),
    TERMINAL_STATES,
    { timeout: 60_000 }
  );
  const first = await page.evaluate(() => ({
    attempts: window.__celly!.cameraAttempts,
    camera: window.__celly!.trackingState().camera
  }));
  expect(first.attempts).toBe(1);
  expect(TERMINAL_STATES).toContain(first.camera);

  // Retry from the onboarding button (now "Try again") issues a second real request.
  await expect(page.locator('[data-celly="enable"]')).toBeVisible();
  await page.click('[data-celly="enable"]');
  await page.waitForFunction(() => window.__celly!.cameraAttempts >= 2, null, { timeout: 60_000 });
  await page.waitForFunction(
    (terminal) => terminal.includes(window.__celly!.trackingState().camera),
    TERMINAL_STATES,
    { timeout: 60_000 }
  );

  // The second failure must not wedge the tracker: the retry affordance is still on offer.
  expect(await page.evaluate(() => window.__celly!.cameraAttempts)).toBe(2);
  expect(TERMINAL_STATES).toContain(await cameraState(page));
  await expect(page.locator('[data-celly="enable"]')).toBeVisible();
});
