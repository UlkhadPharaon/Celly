/* eslint-disable no-undef */
/**
 * Deterministic hand-suite capture and measurement.
 *
 * Run with the dev server on :5173 (`npm run dev -- --port 5173`). It drives the real production
 * pipeline through window.__celly, writes screenshots to docs/screenshots/hand-tests/, and prints
 * JSON metrics for the final report.
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const URL = process.env.CELLY_URL ?? 'http://localhost:5173/';
const OUT = 'docs/screenshots/hand-tests';
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
    app.toggle('showFeedback', false);
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
    ([pose, hand, px, py, ph]) => window.__celly.injectPose(pose, hand, px, py, ph),
    [name, side, x, y, phase]
  );
}

async function injectPoseData(data) {
  await page.evaluate((frameData) => window.__celly.injectPoseData(frameData), data);
}

async function settle(n = 4) {
  await frame(n);
  return debug();
}

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

function summarize(samples) {
  const rigged = samples.filter(
    (sample) => sample?.rig && typeof sample.rig.angleErrorDeg === 'number'
  );
  const offsets = samples
    .filter((sample) => typeof sample?.offsetPx === 'number')
    .map((sample) => sample.offsetPx);
  const meshOffsets = samples
    .filter((sample) => typeof sample?.meshIndexOffsetPx === 'number')
    .map((sample) => sample.meshIndexOffsetPx);
  const pinchOffsets = samples
    .filter((sample) => typeof sample?.meshOffsetPx === 'number')
    .map((sample) => sample.meshOffsetPx);
  const apply = rigged.map((sample) => sample.rig.applyMs);
  const joint = rigged.map((sample) => sample.rig.angleErrorDeg);
  const perFinger = {};
  for (const sample of rigged) {
    for (const [finger, value] of Object.entries(sample.rig.perFingerDeg ?? {})) {
      (perFinger[finger] ??= []).push(value);
    }
  }
  const average = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
  return {
    samples: samples.length,
    riggedSamples: rigged.length,
    wristOffsetMeanPx: Number(average(offsets).toFixed(2)),
    wristOffsetMaxPx: Number(Math.max(0, ...offsets).toFixed(2)),
    wristOffsetMeanPctHeight: Number(
      average(samples.filter((sample) => typeof sample?.offsetPctHeight === 'number').map((sample) => sample.offsetPctHeight)).toFixed(3)
    ),
    wristOffsetMaxPctHeight: Number(
      Math.max(0, ...samples.map((sample) => sample.offsetPctHeight ?? 0)).toFixed(3)
    ),
    meshOffsetMeanPx: Number(average(meshOffsets).toFixed(2)),
    meshOffsetMaxPx: Number(Math.max(0, ...meshOffsets).toFixed(2)),
    meshOffsetMeanPctHeight: Number(
      average(meshOffsets.map((px) => (px / VIEWPORT.height) * 100)).toFixed(3)
    ),
    meshOffsetMaxPctHeight: Number(
      Math.max(0, ...meshOffsets.map((px) => (px / VIEWPORT.height) * 100)).toFixed(3)
    ),
    pinchMidpointOffsetMeanPx: Number(average(pinchOffsets).toFixed(2)),
    pinchMidpointOffsetMaxPx: Number(Math.max(0, ...pinchOffsets).toFixed(2)),
    applyMsMean: Number(average(apply).toFixed(2)),
    applyMsMax: Number(Math.max(0, ...apply).toFixed(2)),
    angleErrorMeanDeg: Number(average(joint).toFixed(2)),
    angleErrorMaxDeg: Number(Math.max(0, ...joint).toFixed(2)),
    perFingerMeanDeg: Object.fromEntries(
      Object.entries(perFinger).map(([finger, values]) => [finger, Number(average(values).toFixed(2))])
    ),
    skin: rigged[0]?.rig?.skin ?? null
  };
}

function boneStability(samples) {
  const lengths = new Map();
  for (const sample of samples) {
    const rig = sample?.rig;
    if (!rig?.boneLengths || typeof sample.scale !== 'number') continue;
    for (const [bone, value] of Object.entries(rig.boneLengths)) {
      const normalized = value / Math.max(1e-6, sample.scale);
      (lengths.get(bone) ?? lengths.set(bone, []).get(bone)).push(normalized);
    }
  }
  let worst = { bone: null, cvPct: 0 };
  for (const [bone, values] of lengths) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const cv = mean > 1e-8 ? (Math.sqrt(variance) / mean) * 100 : 0;
    if (cv > worst.cvPct) worst = { bone, cvPct: Number(cv.toFixed(3)) };
  }
  return { bones: lengths.size, worstCvPct: worst.cvPct, worstBone: worst.bone };
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
  motion[name] = { samples, summary: summarize(samples), bones: boneStability(samples) };
}

// ------------------------------------------------------------------- debug overlay
await page.evaluate(() => {
  window.__celly.toggle('showFeedback', true);
  window.__celly.toggleDebugOverlay(true);
  window.__celly.injectPose('open', 'right', 820, 430, 0);
});
await frame(3);
await shot('debug-hand');
const debugSample = await debug();
await page.evaluate(() => {
  window.__celly.toggleDebugOverlay(false);
  window.__celly.toggle('showFeedback', false);
});

// ------------------------------------------------------------- selection test (exact)
await page.evaluate(() => {
  const app = window.__celly;
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
  await frame(1);
  for (let k = 0; k < 3; k++) {
    await page.evaluate(
      ([x, y]) => window.__celly.injectHand('right', x, y, 0.05),
      [Math.round(anchor.x), Math.round(anchor.y)]
    );
    await page.waitForTimeout(35);
  }
  await frame(1);
  await page.evaluate(
    ([x, y]) => window.__celly.injectHand('right', x, y, 0.96),
    [Math.round(anchor.x), Math.round(anchor.y)]
  );
  await frame(2);
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

// ---------------------------------------------------------- procedural-hand fallback
await page.evaluate(() => window.__celly.toggle('proceduralHand', true));
await page.waitForFunction(
  () => !!window.__celly.debugHand('right')?.rig?.procedural,
  null,
  { timeout: 30000 }
);
await page.evaluate(() => window.__celly.injectPose('open', 'right', 820, 430, 0));
await frame(3);
const proceduralSample = await debug();
await shot('procedural-hand');
await page.evaluate(() => window.__celly.toggle('proceduralHand', false));
await page.waitForFunction(
  () => Array.isArray(window.__celly.debugHand('right')?.rig?.skin),
  null,
  { timeout: 30000 }
);
await page.evaluate(() => window.__celly.injectPose('open', 'right', 820, 430, 0));
await frame(3);
const restoredSample = await debug();
await shot('rigged-restored');

// ------------------------------------------------------------------------- report
const allStatic = Object.values(staticSamples);
const allSamples = [...allStatic, leftSample, ...Object.values(motion).flatMap((entry) => entry.samples)];
const staticSummary = summarize(allStatic);
const allSummary = summarize(allSamples);
const palm = staticSamples.palm?.rig?.palmNormal;
const back = staticSamples.back?.rig?.palmNormal;
const palmDot =
  palm && back
    ? Number(
        (
          palm[0] * back[0] +
          palm[1] * back[1] +
          palm[2] * back[2]
        ).toFixed(3)
      )
    : null;

console.log(
  JSON.stringify(
    {
      errors,
      viewport: VIEWPORT,
      staticSummary,
      staticPerPose: Object.fromEntries(
        Object.entries(staticSamples).map(([name, sample]) => [
          name,
          {
            wristOffsetPctHeight: sample.offsetPctHeight,
            meshIndexOffsetPx: sample.meshIndexOffsetPx,
            meshIndexTip: sample.meshIndexTip,
            cursor: sample.cursor,
            landmarkIndexTip: sample.landmarkIndexTip,
            pinchMidpointOffsetPx: sample.meshOffsetPx,
            angleErrorDeg: sample.rig?.angleErrorDeg ?? null,
            perFingerDeg: sample.rig?.perFingerDeg ?? null,
            applyMs: sample.rig?.applyMs ?? null,
            palmNormal: sample.rig?.palmNormal ?? null,
            scale: sample.scale
          }
        ])
      ),
      allSummary,
      motion: Object.fromEntries(
        Object.entries(motion).map(([name, entry]) => [name, entry.summary])
      ),
      boneStability: boneStability(allSamples),
      palmVsBackDot: palmDot,
      left: {
        present: leftSample.present,
        wristOffsetPctHeight: leftSample.offsetPctHeight,
        meshIndexOffsetPx: leftSample.meshIndexOffsetPx,
        angleErrorDeg: leftSample.rig?.angleErrorDeg ?? null
      },
      debug: {
        present: debugSample.present,
        pickRadius: debugSample.pickRadius ?? null,
        rigged: !debugSample.rig?.procedural,
        cursor: debugSample.cursor,
        landmarkIndexTip: debugSample.landmarkIndexTip,
        meshIndexTip: debugSample.meshIndexTip,
        meshIndexOffsetPx: debugSample.meshIndexOffsetPx
      },
      selection: {
        attempts: selection.attempts,
        hits: selection.hits,
        hitRate: selection.hitRate,
        meanAimErrorPx: selection.meanAimErrorPx,
        complete: selection.complete,
        results: selection.results,
        driver: selectionAttempts
      },
      procedural: {
        procedural: !!proceduralSample.rig?.procedural,
        present: proceduralSample.present,
        offsetPctHeight: proceduralSample.offsetPctHeight,
        restoredRigged: Array.isArray(restoredSample.rig?.skin),
        restoredPresent: restoredSample.present
      }
    },
    null,
    2
  )
);

await browser.close();
