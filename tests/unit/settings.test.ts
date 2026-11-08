import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings, SETTINGS_VERSION, type StoredSettings } from '../../src/core/settings';
import { PINCH_SENSITIVITY } from '../../src/gestures/pinch';
import type { Settings } from '../../src/types';

const base: Settings = { ...DEFAULT_SETTINGS };

describe('settings schema sanitization (CELLY-BUG-002)', () => {
  it('returns the baseline for non-object payloads', () => {
    for (const garbage of [null, undefined, 42, 'garbage', []]) {
      expect(sanitizeSettings(garbage, base)).toEqual(base);
    }
  });

  it('never merges unknown keys into live settings', () => {
    const stored = { ...DEFAULT_SETTINGS, _version: SETTINGS_VERSION, evilKey: 'lol' };
    const cleaned = sanitizeSettings(stored, base);
    expect(Object.keys(cleaned)).toEqual(Object.keys(base));
    expect((cleaned as unknown as Record<string, unknown>).evilKey).toBeUndefined();
  });

  it('rejects boolean fields whose value is not a boolean', () => {
    const polluted = {
      language: 'en',
      quality: base.quality,
      mirrorX: 'yes',
      mirrorY: null,
      showWebcam: 1,
      showFeedback: 0,
      dwellClick: 'on',
      autoRotate: undefined,
      reducedMotion: NaN,
      highContrast: true,
      pinchSensitivity: 'loose',
      handsSwap: false
    };
    const cleaned = sanitizeSettings(polluted, base);
    expect(cleaned.mirrorX).toBe(base.mirrorX);
    expect(cleaned.mirrorY).toBe(base.mirrorY);
    expect(cleaned.showWebcam).toBe(base.showWebcam);
    expect(cleaned.showFeedback).toBe(base.showFeedback);
    expect(cleaned.dwellClick).toBe(base.dwellClick);
    expect(cleaned.autoRotate).toBe(base.autoRotate);
    expect(cleaned.reducedMotion).toBe(base.reducedMotion);
    expect(cleaned.highContrast).toBe(true);
    expect(cleaned.handsSwap).toBe(false);
    expect(cleaned.pinchSensitivity).toBe(base.pinchSensitivity);
  });

  it('normalizes language and quality', () => {
    expect(sanitizeSettings({ language: 'fr', quality: 'high' }, base)).toMatchObject({
      language: 'fr',
      quality: 'high'
    });
    expect(sanitizeSettings({ language: 'de' }, base).language).toBe('en');
    expect(sanitizeSettings({ quality: 'ultra' }, base).quality).toBe(base.quality);
  });

  it('clamps pinch sensitivity into range and rejects non-finite values', () => {
    expect(sanitizeSettings({ pinchSensitivity: 99 }, base).pinchSensitivity).toBe(PINCH_SENSITIVITY.max);
    expect(sanitizeSettings({ pinchSensitivity: 0.1 }, base).pinchSensitivity).toBe(PINCH_SENSITIVITY.min);
    expect(sanitizeSettings({ pinchSensitivity: Infinity }, base).pinchSensitivity).toBe(
      base.pinchSensitivity
    );
    expect(sanitizeSettings({ pinchSensitivity: 'light' }, base).pinchSensitivity).toBe(
      base.pinchSensitivity
    );
  });

  it('falls back to the baseline when the schema version is newer than anything this build knows', () => {
    const future: StoredSettings = { ...DEFAULT_SETTINGS, _version: SETTINGS_VERSION + 1, language: 'fr' };
    const cleaned = sanitizeSettings(future, base);
    expect(cleaned).toEqual(base);
    expect(cleaned.language).toBe(base.language);
  });

  it('accepts the exact shape saveSettings writes', () => {
    const stored: StoredSettings = {
      ...DEFAULT_SETTINGS,
      language: 'fr',
      quality: 'low',
      _version: SETTINGS_VERSION
    };
    const cleaned = sanitizeSettings(stored, base);
    expect(cleaned.language).toBe('fr');
    expect(cleaned.quality).toBe('low');
    expect(cleaned).not.toHaveProperty('_version');
  });
});
