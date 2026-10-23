import { describe, expect, it } from 'vitest';
import { HandSideResolver, type SideDetection } from '../../src/tracking/handSide';

const at = (x: number): SideDetection => ({
  label: 'Left',
  wrist: { x, y: 0, z: 0 },
  score: 0.99
});

describe('HandSideResolver', () => {
  it('flips MediaPipe handedness once (selfie assumption)', () => {
    const r = new HandSideResolver();
    expect(r.resolve([at(0)], { handsSwap: false }, 0)).toEqual(['right']);
  });

  it('applies the manual swap on top of the flip', () => {
    const r = new HandSideResolver();
    expect(r.resolve([at(0)], { handsSwap: true }, 0)).toEqual(['left']);
  });

  it('treats an unknown label as the primary right hand', () => {
    const r = new HandSideResolver();
    expect(r.resolve([{ ...at(0), label: 'Unknown' }], { handsSwap: false }, 0)).toEqual(['right']);
  });

  it('debounces a label switch on the same wrist', () => {
    const r = new HandSideResolver();
    expect(r.resolve([at(0)], { handsSwap: false }, 0)).toEqual(['right']);
    // Same slot, opposite label: hold it for less than 150 ms.
    expect(r.resolve([{ ...at(0), label: 'Right' }], { handsSwap: false }, 40)).toEqual(['right']);
    expect(r.resolve([{ ...at(0), label: 'Right' }], { handsSwap: false }, 140)).toEqual(['right']);
    // Past the debounce the slot switches.
    expect(r.resolve([{ ...at(0), label: 'Right' }], { handsSwap: false }, 200)).toEqual(['left']);
  });

  it('starts a fresh slot after the hand has been lost', () => {
    const r = new HandSideResolver();
    expect(r.resolve([at(0)], { handsSwap: false }, 0)).toEqual(['right']);
    // No detections for longer than the lost window, then the same wrist comes back.
    expect(r.resolve([], { handsSwap: false }, 600)).toEqual([]);
    expect(r.resolve([{ ...at(0), label: 'Right' }], { handsSwap: false }, 700)).toEqual(['left']);
  });

  it('never returns the same side for two hands', () => {
    const r = new HandSideResolver();
    expect(r.resolve([at(0), at(1)], { handsSwap: false }, 0)).toEqual(['right', 'left']);
  });

  it('matches slots by nearest wrist', () => {
    const r = new HandSideResolver();
    const left = { label: 'Left' as const, wrist: { x: 0, y: 0, z: 0 }, score: 1 };
    const right = { label: 'Right' as const, wrist: { x: 0.6, y: 0, z: 0 }, score: 1 };
    expect(r.resolve([left, right], { handsSwap: false }, 0)).toEqual(['right', 'left']);
    // Hands cross: detections arrive in the opposite order but every wrist stays with its slot.
    expect(r.resolve([right, left], { handsSwap: false }, 30)).toEqual(['left', 'right']);
  });
});
