import { expect, type Page, test } from '@playwright/test';

/**
 * Camera constraints follow the device class (audit task 5.1). The stream is opened once at boot
 * with the constraints of the class measured then; rotating a tablet or moving the window to an
 * external display changes that class, and the reopened stream must carry the new resolution and
 * frame rate while the tracker keeps working.
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__celly);
  // The camera only starts on a run where onboarding is already complete.
  await page.click('[data-celly="mouse"]');
  await page.click('[data-celly="next"]');
  await page.click('[data-celly="enter"]');
  await page.reload();
  await page.waitForFunction(() => !!window.__celly);
}

test('a device-class change re-opens the stream with the new constraints', async ({ page }) => {
  await boot(page);

  // The config launches a fake camera with auto-granted permission, so the tracker goes live.
  await page.waitForFunction(() => window.__celly!.trackingState().camera === 'live', null, {
    timeout: 60_000
  });
  const before = await page.evaluate(() => window.__celly!.deviceState());
  expect(before.deviceClass).toBe('desktop');
  expect(before.cameraStreamWidth).toBe(1280);

  // Nothing changed: no churn (the fake device already honours the desktop request).
  const noop = await page.evaluate(() => window.__celly!.refreshDeviceProfile());
  expect(noop).toEqual({ deviceClass: 'desktop', reopened: false });
  expect(await page.evaluate(() => window.__celly!.trackingState().camera)).toBe('live');

  // Emulate the class the app would see on a rotated tablet: coarse pointer + short side.
  await page.evaluate(() => {
    Object.defineProperty(window, 'innerWidth', { value: 844, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 390, configurable: true });
    const original = window.matchMedia.bind(window);
    (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (
      query: string
    ) =>
      query.includes('pointer: coarse')
        ? ({
            matches: true,
            media: query,
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent() {
              return false;
            }
          } as unknown as MediaQueryList)
        : original(query);
  });

  const changed = await page.evaluate(() => window.__celly!.refreshDeviceProfile());
  expect(changed.deviceClass).toBe('phone');
  expect(changed.reopened).toBe(true);

  // Still live, and the new stream is the one being pumped.
  await page.waitForFunction(() => window.__celly!.trackingState().camera === 'live');
  const after = await page.evaluate(() => window.__celly!.deviceState());
  expect(after.deviceClass).toBe('phone');
  expect(after.cameraStreamWidth).toBeLessThan(before.cameraStreamWidth);
  expect(after.cameraStreamWidth).toBeLessThanOrEqual(640);
  expect(after.cameraReopens).toBeGreaterThan(0);
  // The tracker is still tracking: the reopen swapped the media source, not the worker.
  expect(await page.evaluate(() => window.__celly!.trackingState().tracking)).not.toBe('error');
});
