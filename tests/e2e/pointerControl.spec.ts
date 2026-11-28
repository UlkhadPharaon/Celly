import { expect, type Page, test } from '@playwright/test';

async function seedMouseSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('celly:v02:onboarded', 'true');
    localStorage.setItem(
      'celly:v03:session',
      JSON.stringify({
        version: 1,
        participantId: 'CL-E2EPTR',
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

test.describe('pointer & touch controls', () => {
  test('one-pointer drag rotates, two-pointer pinch zooms, tap selects & unselects', async ({
    page,
    isMobile
  }) => {
    await seedMouseSession(page);
    await page.goto('/');
    await expect(page.locator('.page-lab')).toBeVisible();
    // Wait for the 1100ms entrance zoom tween to settle before measuring scale.
    await page.waitForTimeout(1300);

    // Pause auto-rotate so rotation delta comes solely from pointer drag
    await page.click('.auto-rotate');

    const beforeRot = await page.evaluate(() => {
      const app = (window as unknown as { __celly: { pages: Map<string, { rigRotationY: number }> } })
        .__celly;
      return app.pages.get('interactive')!.rigRotationY;
    });

    // 1. Single-pointer drag on canvas
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas.celly-canvas')!;
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 1,
          pointerType: 'touch',
          clientX: cx,
          clientY: cy,
          button: 0
        })
      );
      for (let i = 1; i <= 5; i++) {
        canvas.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            pointerId: 1,
            pointerType: 'touch',
            clientX: cx + i * 18,
            clientY: cy + i * 4
          })
        );
      }
      canvas.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 1,
          pointerType: 'touch',
          clientX: cx + 90,
          clientY: cy + 20
        })
      );
    });

    await page.waitForTimeout(150);
    const afterRot = await page.evaluate(() => {
      const app = (window as unknown as { __celly: { pages: Map<string, { rigRotationY: number }> } })
        .__celly;
      return app.pages.get('interactive')!.rigRotationY;
    });
    expect(Math.abs(afterRot - beforeRot)).toBeGreaterThan(0.05);

    // 2. Two-pointer pinch zoom
    const beforeScale = await page.evaluate(() => {
      const app = (window as unknown as {
        __celly: { pages: Map<string, { zoom: { scale: { x: number } } }> };
      }).__celly;
      return app.pages.get('interactive')!.zoom.scale.x;
    });

    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas.celly-canvas')!;
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 1,
          pointerType: 'touch',
          clientX: cx - 30,
          clientY: cy
        })
      );
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 2,
          pointerType: 'touch',
          clientX: cx + 30,
          clientY: cy
        })
      );
      for (let i = 1; i <= 4; i++) {
        canvas.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            pointerId: 2,
            pointerType: 'touch',
            clientX: cx + 30 + i * 20,
            clientY: cy
          })
        );
      }
      canvas.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 1,
          pointerType: 'touch',
          clientX: cx - 30,
          clientY: cy
        })
      );
      canvas.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 2,
          pointerType: 'touch',
          clientX: cx + 110,
          clientY: cy
        })
      );
    });

    const afterPinchScale = await page.evaluate(() => {
      const app = (window as unknown as {
        __celly: { pages: Map<string, { zoom: { scale: { x: number } } }> };
      }).__celly;
      return app.pages.get('interactive')!.zoom.scale.x;
    });
    expect(afterPinchScale).toBeGreaterThan(beforeScale);

    // 3. Wheel zoom
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas.celly-canvas')!;
      canvas.dispatchEvent(
        new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 180 })
      );
    });
    const afterWheelScale = await page.evaluate(() => {
      const app = (window as unknown as {
        __celly: { pages: Map<string, { zoom: { scale: { x: number } } }> };
      }).__celly;
      return app.pages.get('interactive')!.zoom.scale.x;
    });
    expect(afterWheelScale).toBeLessThan(afterPinchScale);

    // 4. Tap an organelle (nucleus) -> overlay opens; tap empty space -> overlay closes
    const tapDebug = await page.evaluate(() => {
      const app = (window as unknown as {
        __celly: {
          sceneAnchor: (id: string) => { x: number; y: number } | null;
          pages: Map<string, { pick: (x: number, y: number) => string | null }>;
          shell: { registry: { hitTest: (x: number, y: number) => string | null } };
        };
      }).__celly;
      const pt = app.sceneAnchor('nucleus')!;
      return {
        pt,
        picked: app.pages.get('interactive')!.pick(pt.x, pt.y),
        ui: app.shell.registry.hitTest(pt.x, pt.y)
      };
    });
    expect(tapDebug.picked).toBeTruthy();
    expect(tapDebug.ui).toBeNull();
    const targetPt = tapDebug.pt;

    if (isMobile) {
      await page.touchscreen.tap(targetPt.x, targetPt.y);
    } else {
      await page.mouse.click(targetPt.x, targetPt.y);
    }

    await expect(page.locator('.overlay-anchor.is-open')).toBeVisible();

    if (isMobile) {
      await page.touchscreen.tap(12, 200);
    } else {
      await page.mouse.click(12, 200);
    }

    await expect(page.locator('.overlay-anchor')).not.toHaveClass(/is-open/);
  });
});
