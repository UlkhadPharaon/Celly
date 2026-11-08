import { expect, type Page, test } from '@playwright/test';

/**
 * Questionnaire progress indicator (audit UX-004 / task 2.6). A 10- or 48-question run used to
 * show only a thin progress bar and a bare "1 / 10" in the corner; the audit asked for an explicit
 * "Question X of N" header. This drives a real quick quiz and checks the counter tracks the run in
 * both languages.
 */

async function enterLab(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__celly);
  await page.click('[data-celly="mouse"]');
  await page.click('[data-celly="next"]');
  await page.click('[data-celly="enter"]');
  await expect(page.locator('.page-lab')).toBeVisible();
}

test('quiz shows an explicit Question X of N counter', async ({ page }) => {
  await enterLab(page);
  await page.click('.tabs .tab[data-page="test"]');
  await expect(page.locator('.page-test')).toBeVisible();
  await page.click('[data-celly="quick"]');

  const counter = page.locator('.quiz-position');
  await expect(counter).toContainText('Question 1 of 10');

  // Answer the first question and advance: the counter must follow.
  await page.locator('.option').first().click();
  await page.locator('[data-celly="next"]').click();
  await expect(counter).toContainText('Question 2 of 10');

  // It is a header element, not screen-reader decoration: it stays visible at the top.
  const box = await counter.boundingBox();
  const body = await page.locator('.test-body').boundingBox();
  expect(box && body && box.y < body.y + 120).toBe(true);

  // Language switch re-renders the run in French without losing progress.
  await page.keyboard.press('l');
  await expect(counter).toContainText('Question 2 sur 10');
  await page.keyboard.press('l');
  await expect(counter).toContainText('Question 2 of 10');
});

test('the full exam reports its real length in the counter', async ({ page }) => {
  await enterLab(page);
  await page.click('.tabs .tab[data-page="test"]');
  await page.click('[data-celly="full"]');

  const counter = page.locator('.quiz-position');
  await expect(counter).toContainText('Question 1 of 48');

  // Back to the test home so the page is left in a clean state.
  await page.locator('.page-test [data-celly="home"]').first().click();
  await expect(page.locator('.test-head')).toBeVisible();
});
