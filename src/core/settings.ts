import type { QualityMode, Settings } from '../types';
import { clamp } from './math';
import { preferredQuality } from './device';
import { PINCH_SENSITIVITY } from '../gestures/pinch';

/**
 * Schema version of the persisted settings payload (`celly:v02:settings`). Bump it when a
 * stored field changes meaning; `sanitizeSettings` then discards the stale blob instead of
 * merging unknown shapes into live settings (audit CELLY-BUG-002).
 */
export const SETTINGS_VERSION = 1;

/** The settings every fresh visitor gets. `quality` is the device-independent placeholder;
 *  `defaultSettings()` resolves the real device preference and is the actual baseline. */
export const DEFAULT_SETTINGS: Settings = {
  language: 'en',
  mirrorX: true,
  mirrorY: false,
  handsSwap: false,
  showWebcam: true,
  showFeedback: true,
  dwellClick: false,
  autoRotate: true,
  pinchSensitivity: PINCH_SENSITIVITY.normal,
  reducedMotion: false,
  highContrast: false,
  quality: 'high'
};

/** Fresh settings resolved for the current device (quality follows the preferred profile). */
export function defaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS, quality: preferredQuality() };
}

/**
 * What `saveSettings` stores: live settings plus the schema version stamp. `_version` exists
 * only for persistence — it is never read as part of app behaviour.
 */
export type StoredSettings = Omit<Settings, 'quality'> & { quality: QualityMode; _version?: number };

const BOOLEAN_KEYS = [
  'mirrorX',
  'mirrorY',
  'handsSwap',
  'showWebcam',
  'showFeedback',
  'dwellClick',
  'autoRotate',
  'reducedMotion',
  'highContrast'
] as const;

type BooleanKey = (typeof BOOLEAN_KEYS)[number];

/**
 * Turn anything that came out of localStorage into Settings the current build can trust:
 * - the payload must be an object, otherwise fall back to the baseline;
 * - a payload stamped with a newer schema version is discarded wholesale (it was written by a
 *   newer build; tolerating it silently risks a half-compatible state);
 * - unknown keys never merge in — only keys the baseline knows are read;
 * - every field is type-checked individually and falls back to its default, so a corrupted
 *   value degrades to behaviour, not to a crash.
 *
 * `base` defaults to the current device's preferred settings; tests inject a fixed baseline so
 * this function stays runnable in Node.
 */
export function sanitizeSettings(input: unknown, base: Settings = defaultSettings()): Settings {
  const merged: Settings = { ...base };
  if (!input || typeof input !== 'object') return merged;
  const raw = input as Record<string, unknown>;

  if (typeof raw._version === 'number' && raw._version > SETTINGS_VERSION) return base;

  for (const key of BOOLEAN_KEYS) {
    if (typeof raw[key] === 'boolean') merged[key as BooleanKey] = raw[key] as boolean;
  }

  if (raw.language === 'fr' || raw.language === 'en') merged.language = raw.language;
  if (raw.quality === 'low' || raw.quality === 'high') merged.quality = raw.quality;
  if (typeof raw.pinchSensitivity === 'number' && Number.isFinite(raw.pinchSensitivity)) {
    merged.pinchSensitivity = clamp(
      raw.pinchSensitivity,
      PINCH_SENSITIVITY.min,
      PINCH_SENSITIVITY.max
    );
  }

  return merged;
}
