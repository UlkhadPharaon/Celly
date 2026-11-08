import { describe, expect, it } from 'vitest';
import { COPY as onboardingCopy } from '../../src/ui/onboarding';
import { COPY as controlCopy } from '../../src/ui/controlPanel';
import { COPY as hudCopy } from '../../src/ui/hud';
import { LEGEND as shellLegend, UI_COPY as shellCopy } from '../../src/ui/shell';
import { COPY as boundaryCopy } from '../../src/ui/errorBoundary';
import { COPY as labCopy } from '../../src/pages/interactiveLab';
import { COPY as knowledgeCopy } from '../../src/pages/knowledge';
import { COPY as testingCopy } from '../../src/pages/testing/testingPage';
import { APP_STRINGS } from '../../src/core/strings';
import { GESTURE_HINTS, GESTURE_HINTS_FR } from '../../src/gestures/hints';

/**
 * French-completeness guard for the UI copy dictionaries (audit R-03 / Phase 1.5). The content
 * JSON already has its own FR assertions in data.test.ts; this file covers the copy that lives
 * in TypeScript: every `{ en, fr }` pair must carry a non-empty French counterpart with the
 * same shape (same keys, same list lengths). Missing French text must fail the suite, never
 * degrade silently to English.
 */

type Bag = Record<string, unknown>;

function comparePair(en: unknown, fr: unknown, path: string, errors: string[]): void {
  if (typeof en === 'string') {
    if (typeof fr !== 'string' || fr.trim().length === 0) errors.push(`${path}: missing French text`);
    return;
  }
  if (Array.isArray(en)) {
    if (!Array.isArray(fr) || fr.length !== en.length) {
      errors.push(`${path}: French list missing or has a different length`);
      return;
    }
    en.forEach((item, index) => comparePair(item, fr[index], `${path}[${index}]`, errors));
    return;
  }
  if (en && typeof en === 'object') {
    if (!fr || typeof fr !== 'object' || Array.isArray(fr)) {
      errors.push(`${path}: French object missing`);
      return;
    }
    const enBag = en as Bag;
    const frBag = fr as Bag;
    for (const key of Object.keys(enBag)) {
      if (!(key in frBag)) {
        errors.push(`${path}.${key}: missing in French`);
      } else {
        comparePair(enBag[key], frBag[key], `${path}.${key}`, errors);
      }
    }
    for (const key of Object.keys(frBag)) {
      if (!(key in enBag)) errors.push(`${path}.${key}: French-only key`);
    }
    return;
  }
  // Non-text leaves (numbers, booleans, functions) only need the same type on both sides.
  if (typeof en !== typeof fr) errors.push(`${path}: type mismatch between EN and FR`);
}

function checkBilingual(node: unknown, path: string, errors: string[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item, index) => checkBilingual(item, `${path}[${index}]`, errors));
    return;
  }
  const bag = node as Bag;
  const hasEn = 'en' in bag;
  const hasFr = 'fr' in bag;
  if (hasEn || hasFr) {
    if (!hasEn || !hasFr) {
      // A stray single-language object is fine only when it is not Loc-shaped at all; here one
      // of the pair exists, so this is a copy dictionary that lost a language.
      errors.push(`${path}: only one of en/fr is present`);
      return;
    }
    comparePair(bag.en, bag.fr, path, errors);
    return;
  }
  for (const [key, value] of Object.entries(bag)) checkBilingual(value, `${path}.${key}`, errors);
}

function expectComplete(copy: object, label: string): void {
  const errors: string[] = [];
  checkBilingual(copy, label, errors);
  expect(errors, errors.join('\n')).toEqual([]);
}

describe('UI copy is complete in French (R-03)', () => {
  it('onboarding', () => expectComplete(onboardingCopy, 'onboarding'));
  it('control panel', () => expectComplete(controlCopy, 'controlPanel'));
  it('HUD', () => expectComplete(hudCopy, 'hud'));
  it('shell chrome and gesture legend', () => {
    expectComplete(shellCopy, 'shell');
    expectComplete(shellLegend, 'legend');
  });
  it('error boundary', () => expectComplete(boundaryCopy, 'errorBoundary'));
  it('interactive lab page', () => expectComplete(labCopy, 'interactiveLab'));
  it('knowledge page', () => expectComplete(knowledgeCopy, 'knowledge'));
  it('testing page', () => expectComplete(testingCopy, 'testingPage'));
  it('app strings', () => expectComplete(APP_STRINGS, 'appStrings'));

  it('every gesture-state hint has a French counterpart', () => {
    expect(Object.keys(GESTURE_HINTS_FR).sort()).toEqual(Object.keys(GESTURE_HINTS).sort());
    // Hints that appear during active gestures must never fall back to English in FR mode.
    for (const [state, hint] of Object.entries(GESTURE_HINTS)) {
      const fr = GESTURE_HINTS_FR[state as keyof typeof GESTURE_HINTS_FR];
      if (hint.length > 0) expect(fr.trim().length, `${state}: hint missing French text`).toBeGreaterThan(0);
    }
  });
});
