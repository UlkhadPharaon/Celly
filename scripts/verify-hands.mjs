/* eslint-disable no-undef */
/**
 * Deterministic hand-suite capture and measurement for the skeleton overlay.
 *
 * Run with the dev server on :5173 (`npm run dev -- --port 5173`). It drives the real production
 * pipeline through window.__celly, writes screenshots to docs/screenshots/hand-tests/, and prints
 * JSON metrics for the final report.
 *
 * The hand is drawn as 21 joints and 21 bones, not a mesh. The metric that matters is therefore the
 * screen-space error between the drawn index tip and the pointer, plus the fact that every sample
 * reports the skeleton source and full point/segment counts.
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const URL = process.env.CELLY_URL ?? 'http://localhost:5173/';
const OUT = 'docs/screenshots/hand-tests';
const REPORT = 'docs/hand-verification.json';
const VIEWPORT = { width: 1280, height: 800 };
const X = 820;
const Y = 430;

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader'
  ]
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

await page.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem('celly:v02:onboarded', 'true');
});
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__celly && window.__celly.renderedFrames > 4, null, {
  timeout: 60000
});

async function frame(n = 1) {
  const start = await page.evaluate(() => window.__celly.renderedFrames);
  await page.waitForFunction(
    ([s, count]) => window.__celly.renderedFrames >= s + count,
    [start, n],
    { timeout: 60000 }
  );
}

async function prepareLab() {
  await page.evaluate(() => {
    const app = window.__celly;
    app.toggle('showWebcam', false);
    app.toggle('showFeedback', true);
    app.current?.setAutoRotate?.(false);
    app.toggleDebugOverlay(false);
    app.current?.stopSelectionTest?.();
    app.clearInjectedHands();
  });
  await frame(2);
}

async function debug(side = 'right') {
  return page.evaluate((s) => window.__celly.debugHand(s), side);
}

async function injectPose(name, side = 'right', x = X, y = Y, phase = 0) {
  return page.evaluate(
    ([pose, hand, px, py, ph]) => {
      window.__celly.current?.closeOverlay?.();
      return window.__celly.injectPose(pose, hand, px, py, ph);
    },
    [name, side, x, y, phase]
  );
}

async function injectPoseData(data) {
  await page.evaluate((frameData) => {
    window.__celly.current?.closeOverlay?.();
    window.__celly.injectPoseData(frameData);
  }, data);
}

async function settle(n = 4) {
  await frame(n);
  return debug();
}

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

const average = (values) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

function summarize(samples) {
  const offsets = samples
    .filter((sample) => typeof sample?.offsetPx === 'number')
    .map((sample) => sample.offsetPx);
  const indexOffsets = samples
    .filter((sample) => typeof sample?.skeletonIndexOffsetPx === 'number')
    .map((sample) => sample.skeletonIndexOffsetPx);
  const pinchOffsets = samples
    .filter((sample) => typeof sample?.skeletonPinchOffsetPx === 'number')
    .map((sample) => sample.skeletonPinchOffsetPx);
  const points = samples.map((sample) => sample.skeletonPoints).filter((n) => typeof n === 'number');
  const segments = samples
    .map((sample) => sample.skeletonSegments)
    .filter((n) => typeof n === 'number');
  return {
    samples: samples.length,
    skeletonSource: samples.find((sample) => sample?.skeletonSource)?.skeletonSource ?? null,
    points: points.length ? Math.min(...points) : 0,
    segments: segments.length ? Math.min(...segments) : 0,
    wristOffsetMeanPx: Number(average(offsets).toFixed(2)),
    wristOffsetMaxPx: Number(Math.max(0, ...offsets).toFixed(2)),
    wristOffsetMeanPctHeight: Number(
      average(
        samples
          .filter((sample) => typeof sample?.offsetPctHeight === 'number')
          .map((sample) => sample.offsetPctHeight)
      ).toFixed(3)
    ),
    wristOffsetMaxPctHeight: Number(
      Math.max(0, ...samples.map((sample) => sample.offsetPctHeight ?? 0)).toFixed(3)
    ),
    indexOffsetMeanPx: Number(average(indexOffsets).toFixed(2)),
    indexOffsetMaxPx: Number(Math.max(0, ...indexOffsets).toFixed(2)),
    indexOffsetMeanPctHeight: Number(
      average(indexOffsets.map((px) => (px / VIEWPORT.height) * 100)).toFixed(3)
    ),
    indexOffsetMaxPctHeight: Number(
      Math.max(0, ...indexOffsets.map((px) => (px / VIEWPORT.height) * 100)).toFixed(3)
    ),
    pinchOffsetMeanPx: Number(average(pinchOffsets).toFixed(2)),
    pinchOffsetMaxPx: Number(Math.max(0, ...pinchOffsets).toFixed(2))
  };
}

await prepareLab();

// ---------------------------------------------------------------- static pose suite
const staticNames = [
  'open',
  'fist',
  'pinch',
  'point',
  'peace',
  'thumbs-up',
  'ok',
  'spread',
  'palm',
  'back'
];
const staticSamples = {};
for (const name of staticNames) {
  await injectPose(name);
  const sample = await settle(4);
  staticSamples[name] = sample;
  await shot(`pose-${name}`);
}

// ------------------------------------------------------------------ left hand sanity
await injectPose('open', 'left', 430, 430);
const leftSample = await settle(4);
await shot('hand-left');
await page.evaluate(() => window.__celly.injectHand('left', 0, 0, 0, false));

// --------------------------------------------------------- motion pose sequences
const motion = {};
for (const name of ['wiggle', 'wrist-rotation-slow', 'fast-movement']) {
  const sequence = await page.evaluate(
    ([pose, x, y]) => window.__celly.poseSequence(pose, 'right', x, y),
    [name, X, Y]
  );
  const samples = [];
  let shotAt = Math.floor(sequence.length / 2);
  if (name === 'fast-movement') shotAt = Math.floor(sequence.length * 0.65);
  for (let i = 0; i < sequence.length; i++) {
    await injectPoseData(sequence[i]);
    await frame(1);
    samples.push(await debug());
    if (i === shotAt) await shot(`pose-${name}`);
  }
  motion[name] = { samples, summary: summarize(samples) };
}

// ------------------------------------------------------------------- debug overlay
await page.evaluate(() => {
  window.__celly.current?.closeOverlay?.();
  window.__celly.toggle('showFeedback', true);
  window.__celly.toggleDebugOverlay(true);
  window.__celly.injectPose('open', 'right', 820, 430, 0);
});
await frame(3);
await shot('debug-hand');
const debugSample = await debug();
await page.evaluate(() => {
  window.__celly.toggleDebugOverlay(false);
});

// ------------------------------------------------------------- selection test (exact)
await page.evaluate(() => {
  const app = window.__celly;
  app.current?.closeOverlay?.();
  app.injectHand('right', 0, 0, 0, false);
  app.current?.stopSelectionTest?.();
  app.current?.startSelectionTest?.(true);
});
await frame(2);

async function selectionAttempt(index) {
  const state = await page.evaluate(() => window.__celly.selectionTestState());
  if (state.complete || !state.active || !state.target) return { done: true, state };
  const id = state.target;
  const anchor = await page.evaluate((target) => window.__celly.sceneAnchor(target), id);
  if (!anchor) return { done: false, id, error: 'no anchor' };
  await page.evaluate(
    ([x, y]) => window.__celly.injectHand('right', x, y, 0.05),
    [Math.round(anchor.x - 110), Math.round(anchor.y + 50)]
  );
  // Give the 100 ms pre-pinch aim look-back time to fill with the target position. Without this
  // settle a slow SwiftShader frame can leave the lock on the previous approach point, which
  // shows up as a one-off miss even though the hand is on target.
  await page.waitForTimeout(160);
  for (let k = 0; k < 4; k++) {
    await page.evaluate(
      ([x, y]) => window.__celly.injectHand('right', x, y, 0.05),
      [Math.round(anchor.x), Math.round(anchor.y)]
    );
    await frame(1);
    await page.waitForTimeout(50);
  }
  await frame(1);
  await page.evaluate(
    ([x, y]) => window.__celly.injectHand('right', x, y, 0.96),
    [Math.round(anchor.x), Math.round(anchor.y)]
  );
  await frame(2);
  await page.waitForTimeout(120);
  await page.evaluate(
    ([x, y]) => window.__celly.injectHand('right', x, y, 0.05),
    [Math.round(anchor.x), Math.round(anchor.y)]
  );
  await frame(2);
  const advanced = await page
    .waitForFunction((n) => window.__celly.selectionTestState().index > n, index, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  return {
    done: false,
    id,
    anchor: [Math.round(anchor.x), Math.round(anchor.y)],
    advanced,
    state: await page.evaluate(() => window.__celly.selectionTestState())
  };
}

const selectionAttempts = [];
for (let i = 0; i < 10; i++) {
  const result = await selectionAttempt(i);
  selectionAttempts.push(result);
  if (result.done) break;
}
await shot('selection-test-exact');
const selection = await page.evaluate(() => window.__celly.selectionTestState());

// ------------------------------------------------------------------------- report
const allStatic = Object.values(staticSamples);
const allSamples = [...allStatic, leftSample, ...Object.values(motion).flatMap((entry) => entry.samples)];
const staticSummary = summarize(allStatic);
const allSummary = summarize(allSamples);

const report = {
  errors,
  viewport: VIEWPORT,
  staticSummary,
  staticPerPose: Object.fromEntries(
    Object.entries(staticSamples).map(([name, sample]) => [
      name,
      {
        wristOffsetPctHeight: sample.offsetPctHeight,
        indexOffsetPx: sample.skeletonIndexOffsetPx,
        indexTip: sample.skeletonIndexTip,
        cursor: sample.cursor,
        landmarkIndexTip: sample.landmarkIndexTip,
        pinchMidpointOffsetPx: sample.skeletonPinchOffsetPx,
        points: sample.skeletonPoints,
        segments: sample.skeletonSegments,
        source: sample.skeletonSource,
        scale: sample.scale
      }
    ])
  ),
  allSummary,
  motion: Object.fromEntries(Object.entries(motion).map(([name, entry]) => [name, entry.summary])),
  left: {
    present: leftSample.present,
    wristOffsetPctHeight: leftSample.offsetPctHeight,
    indexOffsetPx: leftSample.skeletonIndexOffsetPx,
    points: leftSample.skeletonPoints,
    segments: leftSample.skeletonSegments,
    source: leftSample.skeletonSource
  },
  debug: {
    present: debugSample.present,
    pickRadius: debugSample.pickRadius ?? null,
    source: debugSample.skeletonSource,
    cursor: debugSample.cursor,
    landmarkIndexTip: debugSample.landmarkIndexTip,
    indexTip: debugSample.skeletonIndexTip,
    indexOffsetPx: debugSample.skeletonIndexOffsetPx
  },
  selection: {
    attempts: selection.attempts,
    hits: selection.hits,
    hitRate: selection.hitRate,
    meanAimErrorPx: selection.meanAimErrorPx,
    complete: selection.complete,
    results: selection.results,
    driver: selectionAttempts
  }
};

await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

await browser.close();
