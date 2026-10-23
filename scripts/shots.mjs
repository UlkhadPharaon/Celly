// Screenshot harness for docs/screenshots.
// Boots Chromium with a fake camera, replays synthetic hands through window.__celly and
// captures the three pages plus the onboarding, so the docs never go stale.
//
//   node scripts/shots.mjs            # against http://localhost:5173
//   node scripts/shots.mjs --port 5174
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const port = portArg >= 0 ? args[portArg + 1] : '5173';
const base = `http://localhost:${port}/`;
const outDir = join(process.cwd(), 'docs', 'screenshots');
mkdirSync(outDir, { recursive: true });

const shotArgs = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--enable-unsafe-swiftshader',
  '--force-color-profile=srgb',
  '--force-device-scale-factor=1',
  '--hide-scrollbars',
  // Keep the emulated viewport and the real window the same size. A 1600x1000 emulation inside a
  // default 800x600 window makes the compositor rasterise tiles at two scales, which is what
  // produced the ghost copies of the UI in earlier shots.
  '--window-size=1600,1000',
  // `--disable-gpu` routes the page through the software compositor, where a repainting WebGL
  // canvas intermittently leaves stale tiles behind (the "rescaled copy" ghosts). Leaving the GPU
  // process enabled but pinning ANGLE to SwiftShader keeps composition normal and rendering
  // deterministic; it is slower, which this harness already expects.
  '--use-angle=swiftshader'
];

// The bundled headless shell composites through SwiftShader too, but its compositor is older and
// intermittently tiles the whole page into a ghost grid while a canvas is repainting. Real Chrome
// captures cleanly; fall back to the bundled build when Chrome is not installed.
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', args: shotArgs });
} catch {
  browser = await chromium.launch({ args: shotArgs });
}

const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
// First visit: the onboarding should be the first thing a new user sees.
await context.addInitScript(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* private mode */
  }
});
const page = await context.newPage();
// SwiftShader plus a 7.8 MB model warming up can block the main thread for a while; a 30 s
// screenshot or click timeout turns a slow frame into a failed docs build.
page.setDefaultTimeout(120000);
page.setDefaultNavigationTimeout(120000);
page.on('pageerror', (error) => console.log('[pageerror]', error.message));
page.on('console', (message) => {
  if (message.type() === 'error') console.log('[console.error]', message.text());
});

const tab = (name) => `.tabs .tab[data-page="${name}"]`;

const shot = async (name) => {
  const file = join(outDir, `${name}.png`);
  // The overlay is deliberately invisible until its opacity transition has painted. Under the
  // software compositor that transition can start seconds late, so wait for the computed state
  // instead of assuming the 420 ms settle is enough.
  await page.waitForFunction(
    () => {
      const open = document.querySelector('.overlay-anchor.is-open');
      if (!open) return true;
      const style = getComputedStyle(open);
      return style.visibility === 'visible' && Number(style.opacity) > 0.99;
    },
    null,
    { timeout: 120000 }
  );
  await page.waitForTimeout(420);
  // captureBeyondViewport has a habit of tiling the compositor output under SwiftShader.
  await page.screenshot({ path: file, captureBeyondViewport: false, timeout: 120000 });
  console.log('->', name);
};

/**
 * Camera transitions are dt-driven and dt is clamped to 50 ms, so at the 2–4 fps SwiftShader
 * manages here a 780 ms tween takes several wall-clock seconds. Wait for the tween to report
 * completion instead of guessing with a timeout; otherwise the knowledge shots catch the graph
 * halfway between framings (and at the wrong apparent size).
 */
const settle = async () => {
  await page.waitForFunction(() => !window.__celly.scene.transitioning, null, { timeout: 120000 });
  await page.waitForTimeout(320);
};

const hand = (side, x, y, pinch) =>
  page.evaluate(([s, px, py, value]) => window.__celly.injectHand(s, px, py, value), [side, x, y, pinch]);

const clear = () => page.evaluate(() => window.__celly.clearInjectedHands());

/** Move a synthetic hand, then pinch it, and let the pipeline settle. */
const gesture = async (side, x, y, pinch, settle = 520) => {
  await hand(side, x, y, Math.min(pinch, 0.2));
  await page.waitForTimeout(90);
  if (pinch > 0.5) await hand(side, x, y, pinch);
  await page.waitForTimeout(settle);
};

const anchor = (id) => page.evaluate((node) => window.__celly.sceneAnchor(node), id);

await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__celly);
// `backdrop-filter` layers re-sample the live WebGL canvas; under the software compositor they
// intermittently blend a stale, rescaled copy of their own text (the doubled labels and "-12"
// fragments in earlier shots). The panels keep their dark backgrounds and borders without the
// blur, so captures are unaffected apart from losing a cosmetic effect. Transitions and keyframe
// animations are frozen as well: a still frame has nothing to gain from them, and the software
// compositor can otherwise start a 320 ms fade several seconds after the class change, which is
// how the knowledge overlay dropped out of earlier captures.
await page.addStyleTag({
  content:
    '*, *::before, *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; transition: none !important; animation: none !important; }' +
    // Without the blur, the overlay's 78 % glass lets bright graph labels print through its text.
    // The real app blurs the backdrop; for the capture, keep the same dark glass but opaque enough
    // for the labels to stay readable.
    '.info-overlay { background: rgba(8, 19, 34, 0.97) !important; }' +
    // A still cannot show the flip, and a rotated 3D face is one compositor layer too many for
    // SwiftShader (it tiled the whole page in one run). Flatten the revealed card to its back face.
    '.flashcard, .flash-inner, .flash-face { perspective: none !important; transform-style: flat !important; }' +
    '.flashcard.is-revealed .flash-inner, .flashcard.is-revealed .flash-back { transform: none !important; }' +
    '.flashcard.is-revealed .flash-front { display: none !important; }'
});
const viewport = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
console.log(`viewport ${viewport.w}x${viewport.h} @${await page.evaluate(() => window.devicePixelRatio)}x`);
await page.waitForTimeout(1800);

// 1) welcome
await shot('01-onboarding-welcome');

// 2) hands check (camera already granted by the fake device)
await page.click('[data-celly="enable"]');
await page.waitForTimeout(600);
await gesture('right', 900, 520, 0.1, 400);
await gesture('left', 620, 600, 0.1, 400);
await shot('02-onboarding-hands');

// 3) gesture primer
await page.click('[data-celly="next"]');
await page.waitForTimeout(700);
await shot('03-onboarding-gestures');

await page.click('[data-celly="enter"]');
await clear();
await settle();
await page.waitForTimeout(900);

// 4) the lab, idle
await shot('04-lab');

// 5) the lab with an organelle selected through the real gesture path
const nucleus = await anchor('nucleus');
if (nucleus) await gesture('right', nucleus.x, nucleus.y, 0.96, 1700);
await shot('05-lab-selected');

// 6) unselect, then the knowledge graph
await gesture('right', 250, 880, 0.96, 900);
await clear();
await page.click(tab('knowledge'));
await settle();
await page.waitForTimeout(700);
await shot('06-knowledge');

// 7) a focused knowledge node + its linked ideas
const node = await anchor('mitochondrion');
if (node) await gesture('right', node.x, node.y, 0.96, 1700);
await shot('07-knowledge-focus');

// 8) the quiz home
await clear();
await page.click(tab('test'));
await settle();
await page.waitForTimeout(500);
await shot('08-tests');

// 9) a question, answered through the mouse
await page.click('[data-celly="quick"]');
await page.waitForTimeout(700);
await page.click('[data-celly="option-1"]');
await page.waitForTimeout(800);
await shot('09-quiz-question');

// 10) flashcards, revealed
await page.click('[data-celly="home"]');
await page.waitForTimeout(600);
await page.click('[data-celly="flash"]');
await page.waitForTimeout(700);
await page.click('[data-celly="flip-btn"]');
await page.waitForTimeout(1000);
await shot('10-flashcard-revealed');

// 11) both hands pinching over the lab — scale gesture, cursors, HUD
// Both pinches sit outside the cell so the scale demo does not select anything.
await page.click(tab('interactive'));
await settle();
await page.waitForTimeout(600);
await gesture('right', 1230, 470, 0.96, 260);
await gesture('left', 420, 650, 0.96, 900);
await shot('11-two-hands-scale');

await browser.close();
console.log('done');
