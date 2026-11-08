import { expect, test } from '@playwright/test';

/**
 * Error-boundary recovery (audit CELLY-CRIT-001). A crash used to leave a blank page with no
 * way back; these tests drive the two failure channels the boundary listens to and prove the
 * Retry action rebuilds a working app.
 */

test('an uncaught error shows the recovery overlay and Retry re-boots the app', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__celly);
  await expect(page.locator('.error-boundary')).toBeHidden();

  await page.evaluate(() => {
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'Simulated crash', error: new Error('Simulated crash') })
    );
  });

  const overlay = page.locator('.error-boundary');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('.error-boundary-message')).toContainText('Simulated crash');
  // Technical details are present but collapsed behind <details>.
  await expect(overlay.locator('details')).not.toHaveAttribute('open', '');
  await expect(overlay.locator('.error-boundary-details pre')).toContainText('Simulated crash');

  // Remember the broken instance so the test can prove a *different* one took over.
  await page.evaluate(() => {
    (window as unknown as { __oldApp?: unknown }).__oldApp = window.__celly;
  });

  await page.click('.error-boundary-actions .btn.primary');
  await expect(overlay).toBeHidden({ timeout: 30_000 });
  const rebuilt = await page.evaluate(
    () => !!window.__celly && window.__celly !== (window as unknown as { __oldApp?: unknown }).__oldApp
  );
  expect(rebuilt).toBe(true);
  await expect(page.locator('.page-lab')).toBeVisible();
});

test('an unhandled rejection shows the recovery overlay', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__celly);

  await page.evaluate(() => {
    void Promise.reject(new Error('Simulated rejection'));
  });

  await expect(page.locator('.error-boundary')).toBeVisible();
  await expect(page.locator('.error-boundary-message')).toContainText('Simulated rejection');
});
