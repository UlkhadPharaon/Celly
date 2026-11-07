import { expect, type Page, test } from '@playwright/test';

/**
 * The overlay card is hand-anchored: it repositions while it is open. It used to force two
 * layout reads (rail + control panel) plus an `offsetHeight` on every reposition, and
 * `bounds()` read the card's rect every single frame. This spec proves the card still lands
 * where the organelle is, still follows it when the cell rotates, and that idle frames cost
 * almost no layout work.
 */

async function enterWithMouse(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__celly);
  await page.click('[data-celly="mouse"]', { timeout: 20_000 });
  await page.click('[data-celly="next"]', { timeout: 20_000 });
  await page.click('[data-celly="enter"]', { timeout: 20_000 });
  await expect(page.locator('.page-lab')).toBeVisible();
  await page.waitForTimeout(600);
}

/**
 * Aim at a structure until the picker reports it as hovered, then return its projected
 * anchor. The cell auto-rotates, so one read is never enough.
 */
async function aimAt(page: Page, ids: string[]): Promise<{ id: string; x: number; y: number }> {
  let found: { id: string; x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        for (const id of ids) {
          const anchor = await page.evaluate((node) => window.__celly!.sceneAnchor(node), id);
          if (!anchor) continue;
          await page.evaluate((p) => window.__celly!.injectHand('right', p.x, p.y, 0.1), anchor);
          await page.waitForTimeout(120);
          const hover = await page.evaluate(() => window.__celly!.state.sceneHover);
          if (hover === id) {
            found = { id, ...anchor };
            return id;
          }
        }
        return null;
      },
      { timeout: 20_000 }
    )
    .not.toBeNull();
  return found!;
}

function readCounters(page: Page): Promise<{ rect: number; offset: number }> {
  return page.evaluate(
    () => (window as unknown as { __reads: { rect: number; offset: number } }).__reads
  );
}

test('anchors the info card near the target with bounded layout work', async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as unknown as { __reads: { rect: number; offset: number } };
    win.__reads = { rect: 0, offset: 0 };
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function patched(this: Element) {
      win.__reads.rect += 1;
      return rect.call(this);
    };
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    if (desc?.get) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        configurable: true,
        get: function patched(this: HTMLElement) {
          win.__reads.offset += 1;
          return desc.get!.call(this);
        }
      });
    }
  });

  await enterWithMouse(page);
  // Freeze the cell so the organelle cannot drift between the anchor read and the pinch.
  await page.click('.auto-rotate');
  await expect(page.locator('.auto-rotate')).toHaveAttribute('data-on', 'false');
  await page.waitForTimeout(400);

  const target = await aimAt(page, ['nucleus', 'nucleolus', 'mitochondrion', 'golgi']);
  await page.evaluate((p) => window.__celly!.injectHand('right', p.x, p.y, 0.96), target);
  await page.waitForTimeout(220);
  await page.evaluate((p) => window.__celly!.injectHand('right', p.x, p.y, 0.1), target);
  await page.waitForTimeout(500);

  await expect(page.locator('.overlay-anchor.is-open')).toBeVisible();
  const card = await page.locator('.overlay-anchor').boundingBox();
  expect(card).not.toBeNull();

  // The card hangs off the anchor with a fixed gap, so its nearest edge sits within one card
  // width of the organelle it describes.
  const anchor = await page.evaluate((id) => window.__celly!.sceneAnchor(id), target.id);
  expect(anchor).not.toBeNull();
  const nearestX = Math.max(
    Math.min(anchor!.x - card!.x, card!.x + card!.width - anchor!.x),
    0
  );
  expect(nearestX).toBeLessThan(card!.width + 54);

  // Holding still must cost almost nothing. Before the caching pass, a held card forced two
  // layout reads plus an `offsetHeight` on every 60 ms reposition (~35 reads in this window)
  // and `bounds()` read the rect on top of that, every frame.
  const holdStart = await readCounters(page);
  await page.waitForTimeout(700);
  const holdEnd = await readCounters(page);
  expect(holdEnd.rect - holdStart.rect).toBeLessThanOrEqual(20);
  expect(holdEnd.offset - holdStart.offset).toBeLessThanOrEqual(20);

  // Unfreeze the cell: the card must follow the organelle as it rotates, which proves the
  // reposition path (and its write-on-change guard) is still live.
  await page.evaluate(() => window.__celly!.injectHand('right', 20, 880, 0.1));
  await page.waitForTimeout(260);
  const animateStart = await readCounters(page);
  await page.click('.auto-rotate');
  await expect(page.locator('.auto-rotate')).toHaveAttribute('data-on', 'true');
  await page.waitForTimeout(900);
  const animateEnd = await readCounters(page);
  // While the cell rotates, the card repositions on the anchor's 60 ms cadence — but the rail
  // and control-panel probes are throttled, so the per-second layout cost stays well under what
  // a read-per-frame path would cost.
  const animated = animateEnd.rect - animateStart.rect;
  expect(animated).toBeGreaterThan(0);
  expect(animated).toBeLessThan(40);

  await page.evaluate(() => window.__celly!.clearInjectedHands());
});
