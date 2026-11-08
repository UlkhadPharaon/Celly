import { expect, type Page, test } from '@playwright/test';

/**
 * Insecure-context warning (audit task 5.3). Served over plain http, `getUserMedia` is blocked by
 * the browser, so the camera can never start. The app says so at startup, in the interface
 * language, instead of letting the user discover it by pressing "Enable camera".
 *
 * `localhost` is itself a secure context, so the branch is exercised by overriding the flag in the
 * page. Toasts are captured with a `MutationObserver` installed before the app boots rather than
 * polled afterwards: this host renders WebGL in software, which delays the toast's own dismissal
 * timer by seconds, so a post-hoc poll can easily start after the node is gone.
 */

const COLLECT_TOASTS = () => {
  const seen: string[] = [];
  (window as unknown as { __toasts: string[] }).__toasts = seen;
  const record = (node: Node): void => {
    const element = node as HTMLElement;
    if (element.classList?.contains('toast')) {
      seen.push(element.textContent ?? '');
    }
  };
  // `document`, not `documentElement`: init scripts run before the root element exists.
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(record);
    }
  }).observe(document, { childList: true, subtree: true });
};

async function collectedToasts(page: Page): Promise<string[]> {
  await page.waitForFunction(() => !!window.__celly);
  return page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts);
}

test('a plain-http page warns at startup that hand tracking is unavailable', async ({ page }) => {
  await page.addInitScript(COLLECT_TOASTS);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', { value: false });
  });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('celly:v02:onboarded', 'true'));
  await page.reload();

  const toasts = await collectedToasts(page);
  expect(toasts.join(' | ')).toContain('hand tracking needs https:// or localhost');
});

test('the startup warning follows the interface language', async ({ page }) => {
  await page.addInitScript(COLLECT_TOASTS);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', { value: false });
  });
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('celly:v02:onboarded', 'true');
    localStorage.setItem('celly:v02:settings', JSON.stringify({ _version: 1, language: 'fr' }));
  });
  await page.reload();

  const toasts = await collectedToasts(page);
  expect(toasts.join(' | ')).toContain('https:// ou localhost');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
});

test('a secure context shows no startup warning', async ({ page }) => {
  await page.addInitScript(COLLECT_TOASTS);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('celly:v02:onboarded', 'true'));
  await page.reload();

  const toasts = await collectedToasts(page);
  expect(toasts.join(' | ')).not.toContain('https://');
});
