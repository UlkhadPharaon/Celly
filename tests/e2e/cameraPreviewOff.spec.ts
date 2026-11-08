import { expect, type Page, test } from '@playwright/test';

/**
 * Camera-disabled state UI (audit UX-006 / task 3.2). `showWebcam` hides the preview thumbnail;
 * hand tracking keeps running, so the shell now leaves a persistent, bilingual "Webcam preview
 * off" chip in the top bar, plus a toast explaining that tracking is still on. The chip is also
 * the one-tap way back on.
 */

async function enterLab(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__celly);
  await page.click('[data-celly="mouse"]');
  await page.click('[data-celly="next"]');
  await page.click('[data-celly="enter"]');
  await expect(page.locator('.page-lab')).toBeVisible();
}

test('hiding the webcam preview leaves a persistent indicator until re-enabled', async ({
  page
}) => {
  await enterLab(page);

  const chip = page.locator('.camera-chip');
  const previewSwitch = page.locator('.switch[data-toggle="showWebcam"]');

  await expect(previewSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(chip).toBeHidden();

  // Toggle the preview off: a toast explains that only the preview is hidden.
  await previewSwitch.click();
  await expect(previewSwitch).toHaveAttribute('aria-checked', 'false');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Webcam preview off');
  await expect(page.locator('.toast').last()).toContainText('hand tracking stays on');

  // The indicator is localized with the rest of the shell.
  await page.keyboard.press('l');
  await expect(chip).toContainText('Aperçu caméra masqué');

  // It persists across section switches (it lives in the shell, not the lab page).
  await page.click('.tabs .tab[data-page="knowledge"]');
  await expect(chip).toBeVisible();

  // Clicking the chip is the shortcut back: preview on, chip gone.
  await chip.click();
  await expect(chip).toBeHidden();
  await expect(previewSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.toast').last()).toContainText('Aperçu caméra activé');
});
