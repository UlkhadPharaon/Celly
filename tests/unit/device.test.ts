import { describe, expect, it } from 'vitest';
import { deviceProfileFor } from '../../src/core/device';

describe('deviceProfileFor', () => {
  it('treats a coarse narrow viewport as a phone in both orientations', () => {
    const portrait = deviceProfileFor(390, 844, true, true, 3);
    const landscape = deviceProfileFor(844, 390, true, true, 3);

    expect(portrait.deviceClass).toBe('phone');
    expect(landscape.deviceClass).toBe('phone');
    expect(portrait.defaultQuality).toBe('low');
    expect(portrait.highDpr).toBe(1.5);
    expect(portrait.shadows).toBe(false);
    expect(portrait.bloom).toBe(false);
    expect(portrait.antialias).toBe(false);
    expect(portrait.cameraWidth).toBe(640);
  });

  it('treats a coarse medium viewport as a tablet', () => {
    const profile = deviceProfileFor(768, 1024, true, true, 2);

    expect(profile.deviceClass).toBe('tablet');
    expect(profile.defaultQuality).toBe('low');
    expect(profile.highDpr).toBe(1.75);
    expect(profile.shadows).toBe(false);
    expect(profile.bloom).toBe(true);
    expect(profile.dustCount).toBe(220);
  });

  it('keeps a fine-pointer desktop on the high profile', () => {
    const profile = deviceProfileFor(1440, 900, false, false, 2);

    expect(profile.deviceClass).toBe('desktop');
    expect(profile.defaultQuality).toBe('high');
    expect(profile.highDpr).toBe(2);
    expect(profile.shadows).toBe(true);
    expect(profile.bloom).toBe(true);
    expect(profile.dustCount).toBe(420);
  });

  it('keeps a touch laptop with a fine primary pointer on the desktop profile', () => {
    const profile = deviceProfileFor(1920, 1080, false, true, 1);

    expect(profile.deviceClass).toBe('desktop');
    expect(profile.defaultQuality).toBe('high');
    expect(profile.antialias).toBe(true);
  });

  it('does not antialias high-DPR or touch viewports', () => {
    expect(deviceProfileFor(1440, 900, false, false, 2).antialias).toBe(false);
    expect(deviceProfileFor(1920, 1080, false, true, 1).antialias).toBe(true);
    expect(deviceProfileFor(768, 1024, true, true, 1).antialias).toBe(false);
  });

  it('clamps missing or absurd device pixel ratios', () => {
    expect(deviceProfileFor(1440, 900, false, false, Number.NaN).highDpr).toBe(1);
    expect(deviceProfileFor(390, 844, true, true, 8).highDpr).toBe(1.5);
  });
});
