/**
 * Record the deterministic hand-pose suite as replayable landmark JSON.
 *
 *   npm run dev -- --port 5173
 *   node scripts/write-hand-fixtures.mjs
 *
 * The app's pose generator is the single source of truth. This script only snapshots it so a bug
 * report can replay the exact same 21-point frames without a webcam.
 */
/* eslint-disable no-undef */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.CELLY_URL ?? 'http://localhost:5173/';
const OUT = path.resolve('tests/fixtures/hand-poses');
const VIEWPORT = { width: 1280, height: 800 };
const POSES = [
  'open',
  'fist',
  'pinch',
  'point',
  'peace',
  'thumbs-up',
  'ok',
  'spread',
  'palm',
  'back',
  'wiggle',
  'wrist-rotation-slow',
  'fast-movement'
];

const browser = await chromium.launch({
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader'
  ]
});
const page = await browser.newPage({ viewport: VIEWPORT });
await page.addInitScript(() => localStorage.clear());
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__celly);
await mkdir(OUT, { recursive: true });

async function writeFixture(file, name, side, frames) {
  const payload = {
    version: 1,
    name,
    side,
    viewport: VIEWPORT,
    generatedBy: 'src/core/handPoses.ts',
    frames
  };
  await writeFile(path.join(OUT, file), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`${file}: ${frames.length} frame(s)`);
}

for (const name of POSES) {
  const data = await page.evaluate((pose) => {
    const app = window.__celly;
    const sequences = ['wiggle', 'wrist-rotation-slow', 'fast-movement'];
    return sequences.includes(pose)
      ? app.poseSequence(pose, 'right', 700, 380)
      : [app.makePose(pose, 'right', 700, 380)];
  }, name);
  await writeFixture(`${name}.json`, name, 'right', data);
}

const left = await page.evaluate(() => [window.__celly.makePose('open', 'left', 1000, 380)]);
await writeFixture('left-open.json', 'open', 'left', left);

await browser.close();
