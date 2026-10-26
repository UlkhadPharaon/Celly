import { expect, type Page, test } from '@playwright/test';

/** The mouse path skips the camera and MediaPipe but keeps the whole app functional. */
async function enterWithMouse(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.onboarding.is-open')).toBeVisible();
  await page.click('[data-celly="mouse"]');
  await page.click('[data-celly="next"]');
  await page.click('[data-celly="enter"]');
  await expect(page.locator('.onboarding')).not.toHaveClass(/is-open/);
}

test.describe('shell', () => {
  test('boots into the lab with the brand, the three sections and the onboarding', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');
    await expect(page.locator('.brand')).toContainText('CELLY');
    await expect(page.locator('.brand')).toContainText('v0.2');
    await expect(page.locator('.onboarding.is-open')).toBeVisible();
    await expect(page.locator('.onboarding-card')).toContainText('A cell you can hold');

    const tabs = page.locator('.tabs .tab');
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toContainText('Interactive');
    await expect(tabs.nth(1)).toContainText('Knowledge');
    await expect(tabs.nth(2)).toContainText('Test');

    await page.click('[data-celly="mouse"]');
    await page.click('[data-celly="next"]');
    await expect(page.locator('.onboarding-card')).toContainText('Four gestures');
    await page.click('[data-celly="enter"]');

    await expect(page.locator('.page-lab')).toBeVisible();
    await expect(page.locator('.tabs .tab[data-page="interactive"]')).toHaveClass(/is-active/);
    await expect(page.locator('.celly-canvas')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('surfaces the GitHub source and learn-article links everywhere in the shell', async ({ page }) => {
    const github = 'https://github.com/UlkhadPharaon/Celly';
    const article =
      'https://medium.com/@ulrichtapsoba2009/from-rgb-camera-to-3d-interaction-how-controller-free-xr-could-transform-learning-d920d92cf5ba';

    await page.goto('/');
    const onboarding = page.locator('.onboarding-links a');
    await expect(onboarding).toHaveCount(2);
    await expect(onboarding.nth(0)).toHaveAttribute('href', github);
    await expect(onboarding.nth(1)).toHaveAttribute('href', article);
    await expect(onboarding.nth(0)).toHaveAttribute('target', '_blank');
    await expect(onboarding.nth(0)).toHaveAttribute('rel', /noopener/);

    await page.click('[data-celly="mouse"]');
    await page.click('[data-celly="next"]');
    await page.click('[data-celly="enter"]');

    const topbar = page.locator('.top-project-links a');
    await expect(topbar).toHaveCount(2);
    await expect(topbar.nth(0)).toHaveAttribute('href', github);
    await expect(topbar.nth(1)).toHaveAttribute('href', article);

    const panel = page.locator('.controls .project-links a');
    await expect(panel).toHaveCount(2);
    await expect(panel.nth(0)).toHaveAttribute('href', github);
    await expect(panel.nth(1)).toHaveAttribute('href', article);
    await expect(panel.nth(1)).toHaveAttribute('target', '_blank');
    await expect(panel.nth(1)).toHaveAttribute('rel', /noreferrer/);
  });

  test('switches sections from the top tabs', async ({ page }) => {
    await enterWithMouse(page);

    await page.click('.tabs .tab[data-page="knowledge"]');
    await expect(page.locator('.page-knowledge')).toBeVisible();
    await expect(page.locator('.tabs .tab[data-page="knowledge"]')).toHaveClass(/is-active/);

    await page.click('.tabs .tab[data-page="test"]');
    await expect(page.locator('.page-test')).toBeVisible();
    await expect(page.locator('.test-body')).toContainText('Quick quiz');

    await page.click('.tabs .tab[data-page="interactive"]');
    await expect(page.locator('.page-lab')).toBeVisible();
  });

  test('switches the interface language to French', async ({ page }) => {
    await enterWithMouse(page);
    await page.click('[data-lang="fr"]');
    await expect(page.locator('.tabs .tab[data-page="interactive"]')).toContainText('Laboratoire');
    await expect(page.locator('.tabs .tab[data-page="knowledge"]')).toContainText('Savoirs');
    await page.click('[data-lang="en"]');
    await expect(page.locator('.tabs .tab[data-page="knowledge"]')).toContainText('Knowledge');
  });

  test('runs a quick quiz through the mouse controls', async ({ page }) => {
    await enterWithMouse(page);
    await page.click('.tabs .tab[data-page="test"]');
    await page.click('[data-celly="quick"]');

    const options = page.locator('.option');
    await expect(options).toHaveCount(4);
    await options.first().click();
    await expect(page.locator('.answer-panel')).toBeVisible();
    await expect(page.locator('[data-celly="next"]')).toBeVisible();
    await page.locator('[data-celly="next"]').click();
    await expect(page.locator('.option')).toHaveCount(4);
  });

  test('reveals a flashcard and grades it', async ({ page }) => {
    await enterWithMouse(page);
    await page.click('.tabs .tab[data-page="test"]');
    await page.click('[data-celly="flash"]');
    await expect(page.locator('.flashcard')).toBeVisible();
    await page.click('[data-celly="flip-btn"]');
    await expect(page.locator('.flashcard')).toHaveClass(/is-revealed/);
    await page.click('[data-celly="knew"]');
    await expect(page.locator('.flashcard')).toBeVisible();
  });
});
