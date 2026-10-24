import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPose, buildPoseSequence } from '../../src/core/handPoses';

const FIXTURES = path.resolve('tests/fixtures/hand-poses');
const VIEWPORT = { width: 1280, height: 800 };
const MIRROR = { mirrorX: true, mirrorY: false };

interface FixtureFrame {
  side: 'left' | 'right';
  landmarks: Array<{ x: number; y: number; z: number }>;
  world: Array<{ x: number; y: number; z: number }>;
  pinch: number;
  pinching: boolean;
}

interface Fixture {
  version: number;
  name: string;
  side: 'left' | 'right';
  frames: FixtureFrame[];
}

function load(name: string): Fixture {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8')) as Fixture;
}

describe('hand pose fixtures', () => {
  it('covers every pose in the acceptance suite', () => {
    for (const name of [
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
      'fast-movement',
      'left-open'
    ]) {
      const fixture = load(name);
      expect(fixture.version).toBe(1);
      expect(fixture.frames.length).toBeGreaterThan(0);
    }
  });

  it('contains finite 21-point landmarks with a plausible wrist span', () => {
    for (const name of ['open', 'fist', 'pinch', 'spread', 'left-open']) {
      const fixture = load(name);
      for (const frame of fixture.frames) {
        expect(frame.landmarks).toHaveLength(21);
        expect(frame.world).toHaveLength(21);
        for (const p of [...frame.landmarks, ...frame.world]) {
          expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
        }
        const wrist = frame.world[0];
        const mcp = frame.world[9];
        expect(Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y, mcp.z - wrist.z)).toBeGreaterThan(0.04);
      }
    }
  });

  it('marks the two grasp poses as pinching and leaves the open hand relaxed', () => {
    expect(load('pinch').frames[0].pinching).toBe(true);
    expect(load('pinch').frames[0].pinch).toBeGreaterThan(0.9);
    expect(load('ok').frames[0].pinching).toBe(true);
    expect(load('open').frames[0].pinching).toBe(false);
    expect(load('open').frames[0].pinch).toBe(0);
  });

  it('records multi-frame motion for wiggle, wrist rotation and fast movement', () => {
    for (const name of ['wiggle', 'wrist-rotation-slow', 'fast-movement']) {
      const fixture = load(name);
      expect(fixture.frames).toHaveLength(13);
      const first = fixture.frames[0].world[12];
      const max = Math.max(
        ...fixture.frames.map((frame) => {
          const p = frame.world[12];
          return Math.hypot(p.x - first.x, p.y - first.y, p.z - first.z);
        })
      );
      expect(max).toBeGreaterThan(0.0005);
    }
  });

  it('matches the live generator for the canonical right-hand open pose', () => {
    const fixture = load('open').frames[0];
    const live = buildPose('open', 'right', 700, 380, VIEWPORT, MIRROR);
    expect(fixture.landmarks).toEqual(live.landmarks);
    expect(fixture.world).toEqual(live.world);
  });

  it('produces a fast-movement sequence with large screen travel', () => {
    const frames = buildPoseSequence('fast-movement', 'right', 700, 380, VIEWPORT, MIRROR);
    expect(frames).toHaveLength(13);
    const xs = frames.map((f) => f.wrist.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(400);
  });
});
