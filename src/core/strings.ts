/**
 * Toast and status copy that belongs to the app shell rather than a page or panel.
 * Pure data so the FR-completeness test can walk it without booting the DOM (see
 * tests/unit/uiCopy.test.ts).
 */
export const APP_STRINGS = {
  en: {
    cameraUnavailable: 'Camera unavailable.',
    trackingFailed: 'Hand model failed to load. Reload the page to retry.',
    saved: 'Saved',
    pinchSaved: 'Pinch sensitivity saved',
    qualityHigh: 'High quality',
    qualityFast: 'Fast mode',
    previewOff: 'Webcam preview hidden — hand tracking stays on.',
    previewOn: 'Webcam preview on',
    progressReset: 'Learning progress reset'
  },
  fr: {
    cameraUnavailable: 'Caméra indisponible.',
    trackingFailed: 'Le modèle de main n’a pas pu être chargé. Rechargez la page.',
    saved: 'Enregistré',
    pinchSaved: 'Sensibilité du pincement enregistrée',
    qualityHigh: 'Qualité élevée',
    qualityFast: 'Mode rapide',
    previewOff: 'Aperçu caméra masqué — le suivi des mains reste actif.',
    previewOn: 'Aperçu caméra activé',
    progressReset: 'Progression réinitialisée'
  }
};
