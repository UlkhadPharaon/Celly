import { expect, type Page, test } from '@playwright/test';

/**
 * Selection-test coordinate audit at non-default device pixel ratios (audit task 2.1).
 *
 * The built-in Selection Test (T) asks for ten organelles and scores each pinch by the distance
 * between where the hand aimed and where the target was projected. All of that math is meant to
 * live in CSS pixels — the renderer scales for DPR, the picking must not — so running the test at
 * DPR 1, 1.5 and 2 guards against device-pixel leakage in projection or hit-testing. A DPR bug
 * shows up as a hit rate collapse or a aim error measured in hundreds of pixels, not here.
 */

type TestSnapshot = {
  active: boolean;
  complete: boolean;
  target: string | null;
  index: number;
  total: number;
  attempts: number;
  hits: number;
  hitRate: number;
  meanAimErrorPx: number;
};

async function enterLab(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__celly);
  await page.click('[data-celly="mouse"]');
  await page.click('[data-celly="next"]');
  await page.click('[data-celly="enter"]');
  await expect(page.locator('.page-lab')).toBeVisible();
  await page.waitForTimeout(1200);
}

/** Wait for rendered frames instead of wall-clock sleeps (SwiftShader hosts run ~1.3 fps). */
async function waitFrames(page: Page, count: number): Promise<void> {
  const start = await page.evaluate(() => window.__celly!.renderedFrames);
  await page.waitForFunction(
    ([s, n]) => window.__celly!.renderedFrames >= s + n,
    [start, count],
    { timeout: 30_000 }
  );
}

async function snapshot(page: Page): Promise<TestSnapshot> {
  return (await page.evaluate(() => window.__celly!.selectionTestState())) as unknown as TestSnapshot;
}

/**
 * Hover an open hand over the target until the app reports it as the armed scene target.
 * Re-reads the projected anchor every poll: the cell bobs gently, so a stale anchor can miss.
 */
async function arm(page: Page, id: string): Promise<{ x: number; y: number }> {
  let point: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        const anchor = await page.evaluate((node) => window.__celly!.sceneAnchor(node), id);
        if (!anchor) return null;
        point = anchor;
        await page.evaluate(({ x, y }) => window.__celly!.injectHand('right', x, y, 0.1), anchor);
        await waitFrames(page, 1);
        return page.evaluate(() => window.__celly!.state.sceneHover);
      },
      { timeout: 40_000, intervals: [100, 250, 500] }
    )
    .toBe(id);
  return point!;
}

/** Pinch at the live anchor; the harness scores the attempt on the pinch-start frame. */
async function pinchTarget(page: Page, id: string, value: number): Promise<void> {
  await page.evaluate(
    ({ node, pinch }) => {
      const anchor = window.__celly!.sceneAnchor(node);
      if (anchor) window.__celly!.injectHand('right', anchor.x, anchor.y, pinch);
    },
    { node: id, pinch: value }
  );
  await waitFrames(page, 1);
}

/**
 * Drive `limit` attempts of the built-in harness. Five organelles cover three size classes, and a
 * device-pixel/cursor-coordinate bug is systematic — it misses everything — so the fractional
 * ratios use a subset to stay inside the suite's time budget on software GL. DPR 1 runs the full
 * ten-target test and asserts completion.
 */
async function runSelectionTest(page: Page, limit: number): Promise<TestSnapshot> {
  await page.keyboard.press('t');
  await expect(page.locator('.lab-test-panel')).toBeVisible();
  const started = await snapshot(page);
  expect(started.active).toBe(true);
  expect(started.total).toBeGreaterThanOrEqual(10);

  const attempts = Math.min(limit, started.total);
  for (let index = 0; index < attempts; index++) {
    const before = await snapshot(page);
    expect(before.index, `harness did not advance to attempt ${index}`).toBe(index);
    expect(before.attempts).toBe(index);
    expect(before.target, `attempt ${index} has no target`).toBeTruthy();
    const target = before.target!;

    await arm(page, target);
    // Committing on pinch start means the armed target must be the harness target: if the hand
    // overlaps a neighbour here the score would be a genuine miss, which is what we want to catch.
    expect(await page.evaluate(() => window.__celly!.state.sceneHover)).toBe(target);

    await pinchTarget(page, target, 0.96);
    await expect
      .poll(async () => (await snapshot(page)).attempts, { timeout: 40_000 })
      .toBe(index + 1);

    // Releasing lets the next target's pinch produce a fresh pinchStart edge. The next aim
    // injects an open hand anyway, but release now so the harness timer can advance in parallel.
    await page.evaluate(
      (node) => {
        const anchor = window.__celly!.sceneAnchor(node);
        if (anchor) window.__celly!.injectHand('right', anchor.x, anchor.y, 0.1);
      },
      target
    );
    // recordSelectionAttempt holds the harness for 440 ms before advancing.
    await expect
      .poll(
        async () => {
          const state = await snapshot(page);
          return state.complete || state.index > index;
        },
        { timeout: 40_000 }
      )
      .toBe(true);
  }

  return snapshot(page);
}

for (const scenario of [
  { dpr: 1, attempts: 10, timeout: 180_000 },
  { dpr: 1.5, attempts: 5, timeout: 180_000 },
  { dpr: 2, attempts: 5, timeout: 240_000 }
] as const) {
  test.describe(`selection test at devicePixelRatio ${scenario.dpr}`, () => {
    test.use({ deviceScaleFactor: scenario.dpr });

    test(`organelles are selectable in CSS-pixel space (DPR ${scenario.dpr})`, async ({ page }) => {
      test.setTimeout(scenario.timeout);
      await enterLab(page);
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(scenario.dpr);

      const result = await runSelectionTest(page, scenario.attempts);
      // Every attempt was aimed at the target's own projected anchor. The test is deliberately
      // harsh: one flaky miss is tolerated, but a coordinate-space bug fails every attempt.
      expect(result.attempts).toBe(Math.min(scenario.attempts, result.total));
      expect(result.hitRate).toBeGreaterThanOrEqual(0.9);
      expect(result.meanAimErrorPx).toBeLessThan(8);
      if (scenario.attempts >= result.total) expect(result.complete).toBe(true);

      // Leave the harness rather than leaving a half-finished test running behind the spec.
      if (!result.complete) await page.keyboard.press('t');
    });
  });
}
