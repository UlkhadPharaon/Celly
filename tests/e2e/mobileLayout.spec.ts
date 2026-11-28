import { expect, type Page, test } from '@playwright/test';

async function seedMouseSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('celly:v02:onboarded', 'true');
    localStorage.setItem(
      'celly:v03:session',
      JSON.stringify({
        version: 1,
        participantId: 'CL-E2EMOB',
        startedAt: Date.now(),
        endedAt: null,
        language: 'en',
        mode: 'mouse',
        tourCompleted: true,
        readingSeconds: 0,
        quiz: [],
        quizTotal: 0,
        survey: null
      })
    );
  });
}

const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568 },
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '820x1180', width: 820, height: 1180 },
  { name: '844x390-landscape', width: 844, height: 390 }
];

test.describe('mobile & tablet layout', () => {
  for (const vp of VIEWPORTS) {
    test(`shell and pages fit without overflow at ${vp.name}`, async ({ page }) => {
      await seedMouseSession(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');
      await expect(page.locator('.page-lab')).toBeVisible();

      // No horizontal overflow
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);

      // Every visible topbar control fits inside the viewport
      const topbarIssues = await page.evaluate(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const issues: string[] = [];
        const items = document.querySelectorAll<HTMLElement>(
          '.topbar button, .topbar a, .topbar .tab'
        );
        for (const el of items) {
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.left < -1 || r.right > vw + 1 || r.top < -1 || r.bottom > vh + 1) {
            issues.push(`${el.className}: [${r.left.toFixed(1)}, ${r.right.toFixed(1)}] vs ${vw}`);
          }
          if (window.matchMedia('(pointer: coarse)').matches) {
            if (r.width < 43.5 || r.height < 43.5) {
              issues.push(`${el.className} too small: ${r.width.toFixed(1)}x${r.height.toFixed(1)}`);
            }
          }
        }
        return issues;
      });
      expect(topbarIssues).toEqual([]);

      // .lab-hint is visible on phone/tablet and .page-intro p >= 12px when visible
      await expect(page.locator('.page-lab .lab-hint')).toBeVisible();
      const introFontPx = await page.evaluate(() => {
        const p = document.querySelector<HTMLElement>('.page-lab .page-intro p');
        if (!p) return 12;
        const s = getComputedStyle(p);
        return s.display === 'none' ? 12 : parseFloat(s.fontSize);
      });
      expect(introFontPx).toBeGreaterThanOrEqual(12);

      // Collapsed bottom sheet camera-status row is not clipped below viewport
      const sheetCheck = await page.evaluate(() => {
        const status = document.querySelector<HTMLElement>('.controls .camera-status');
        if (!status) return null;
        const r = status.getBoundingClientRect();
        return { bottom: r.bottom, innerHeight: window.innerHeight };
      });
      if (sheetCheck) {
        expect(sheetCheck.bottom).toBeLessThanOrEqual(sheetCheck.innerHeight + 1);
      }

      // Knowledge page containment
      await page.click('.tabs .tab[data-page="knowledge"]');
      await expect(page.locator('.page-knowledge')).toBeVisible();
      const knowledgeOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      );
      expect(knowledgeOverflow).toBe(true);

      // Test page containment
      await page.click('.tabs .tab[data-page="test"]');
      await expect(page.locator('.page-test')).toBeVisible();
      const testOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      );
      expect(testOverflow).toBe(true);
    });
  }
});
