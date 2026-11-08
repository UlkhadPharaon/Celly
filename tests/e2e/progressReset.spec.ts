import { expect, type Page, test } from '@playwright/test';

/**
 * Leitner / quiz progress reset (audit task 3.3). The stores could already clear themselves, but
 * nothing in the UI could reach them. This seeds real saved progress, reloads, then drives the
 * control-panel confirmation: Cancel must keep everything, Reset must clear both stores and the
 * visible stats.
 */

async function enterLab(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__celly);
  await page.click('[data-celly="mouse"]');
  await page.click('[data-celly="next"]');
  await page.click('[data-celly="enter"]');
  await expect(page.locator('.page-lab')).toBeVisible();
}

test('reset progress asks first, then clears quiz scores and flashcard boxes', async ({
  page
}) => {
  await enterLab(page);

  // Seed persisted learning state, then reload so the stores read it at construction.
  await page.evaluate(() => {
    localStorage.setItem(
      'celly:v02:leitner',
      JSON.stringify({ f01: { box: 5, lastSeen: Date.now(), correct: 9, wrong: 0 } })
    );
    localStorage.setItem(
      'celly:v02:progress',
      JSON.stringify({ best: { 'mcq:quick': 1 }, attempts: 3, lastPlayed: Date.now() })
    );
  });
  await page.reload();
  await page.waitForFunction(() => !!window.__celly);

  await page.click('.tabs .tab[data-page="test"]');
  await expect(page.locator('.page-test')).toBeVisible();
  const stats = page.locator('.test-stats');
  await expect(stats).toContainText('100%');
  await expect(stats).toContainText('3');
  await expect(stats).toContainText('1/36');

  // First press opens the prompt; it does not reset anything.
  await page.click('[data-celly="reset-progress"]');
  const confirm = page.locator('.control-confirm');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('cannot be undone');

  // The prompt follows the interface language.
  await page.keyboard.press('l');
  await expect(confirm).toContainText('irréversible');
  await page.keyboard.press('l');
  await expect(confirm).toContainText('cannot be undone');

  // Cancel keeps the saved state.
  await page.click('[data-celly="reset-cancel"]');
  await expect(confirm).toBeHidden();
  await expect(stats).toContainText('100%');
  await expect(stats).toContainText('3');

  // Confirm clears both stores and the visible stats.
  await page.click('[data-celly="reset-progress"]');
  await page.click('[data-celly="reset-confirm"]');
  await expect(confirm).toBeHidden();
  await expect(stats).toContainText('0%');
  await expect(stats).toContainText('0/36');
  await expect(page.locator('.toast').last()).toContainText('Learning progress reset');

  const saved = await page.evaluate(() => ({
    leitner: JSON.parse(localStorage.getItem('celly:v02:leitner') ?? '{}') as Record<
      string,
      unknown
    >,
    progress: JSON.parse(localStorage.getItem('celly:v02:progress') ?? '{}') as {
      attempts?: number;
      best?: Record<string, number>;
    }
  }));
  expect(saved.leitner).toEqual({});
  expect(saved.progress.attempts).toBe(0);
  expect(saved.progress.best).toEqual({});
});
