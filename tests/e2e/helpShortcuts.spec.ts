import { expect, type Page, test } from '@playwright/test';

/**
 * Keyboard shortcut discoverability (audit task 2.5). The keybindings previously existed only in
 * code: nothing in the UI told a user that H opens help or 1/2/3 switch sections. The help modal
 * now carries a reference sheet, and pressing H or ? opens straight onto it. This spec drives the
 * real modal and checks the rows, the FR counterpart and that Escape closes it again.
 */

async function enterLab(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__celly);
  await page.click('[data-celly="mouse"]');
  await page.click('[data-celly="next"]');
  await page.click('[data-celly="enter"]');
  await expect(page.locator('.page-lab')).toBeVisible();
}

/** The rendered keycaps of the shortcut sheet, in order. */
function keycaps(page: Page): Promise<string[]> {
  return page.locator('.shortcut-sheet kbd').allTextContents();
}

test('help opens on a complete keyboard shortcut reference', async ({ page }) => {
  await enterLab(page);

  // H opens the help modal directly on the gestures/shortcuts step.
  await page.keyboard.press('h');
  const onboarding = page.locator('.onboarding.is-open');
  await expect(onboarding).toBeVisible();
  await expect(page.locator('.onboarding-card')).toHaveAttribute('data-step', '2');

  const sheet = page.locator('.shortcut-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Keyboard shortcuts');

  // Every key handled by the app is documented.
  expect(await keycaps(page)).toEqual([
    '1', '2', '3',
    'R',
    'M',
    'L',
    'D',
    'T',
    'H', '?',
    'Esc'
  ]);
  await expect(sheet).toContainText('Lab · Knowledge · Test');
  await expect(sheet).toContainText('Auto-rotate the cell');
  await expect(sheet).toContainText('Close the overlay');

  // Escape closes the help modal without entering onboarding-again state.
  await page.keyboard.press('Escape');
  await expect(page.locator('.onboarding')).not.toHaveClass(/is-open/);
  await expect(page.locator('.page-lab')).toBeVisible();
});

test('? opens the same sheet, and it is complete in French', async ({ page }) => {
  await enterLab(page);

  // "?" also opens help (Shift+/). Playwright types the character directly.
  await page.keyboard.press('?');
  await expect(page.locator('.onboarding.is-open')).toBeVisible();
  await expect(page.locator('.shortcut-sheet')).toContainText('Keyboard shortcuts');

  // L toggles the interface language; the open modal re-renders in French in place.
  await page.keyboard.press('l');
  const sheet = page.locator('.shortcut-sheet');
  await expect(sheet).toContainText('Raccourcis clavier');
  await expect(sheet).toContainText('Rotation automatique de la cellule');
  await expect(sheet).toContainText('Fermer la fenêtre');
  // Keys are language-independent: the same cap sequence survives the switch.
  expect(await keycaps(page)).toEqual([
    '1', '2', '3',
    'R',
    'M',
    'L',
    'D',
    'T',
    'H', '?',
    'Esc'
  ]);
});
