import type { GestureState } from '../types';

/**
 * Short copy shown next to the pinch cursor. The gesture engine is language-agnostic
 * (DECISIONS D-18), so both language tables live here as pure data: the engine reads the
 * English table, the app reads the French one at the display boundary.
 */
export const GESTURE_HINTS: Record<GestureState, string> = {
  IDLE: '',
  HOVER_UI: 'Pinch to click',
  SELECTING: 'Release',
  ROTATING: 'Rotate',
  SCALING: 'Scale',
  SWIPING: 'Swipe',
  COOLDOWN: ''
};

export const GESTURE_HINTS_FR: Record<GestureState, string> = {
  IDLE: '',
  HOVER_UI: 'Pincez pour cliquer',
  SELECTING: 'Relâchez',
  ROTATING: 'Tourner',
  SCALING: 'Échelle',
  SWIPING: 'Balayer',
  COOLDOWN: ''
};
