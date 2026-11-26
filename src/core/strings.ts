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
    qualityAuto: 'Fast mode enabled: the scene could not hold 30 fps, and tracking stays smooth.',
    previewOff: 'Webcam preview hidden — hand tracking stays on.',
    previewOn: 'Webcam preview on',
    progressReset: 'Learning progress reset',
    studySaved: 'Study answers saved on this device.',
    insecureContext:
      'Camera unavailable: hand tracking needs https:// or localhost. Reload over a secure connection.'
  },
  fr: {
    cameraUnavailable: 'Caméra indisponible.',
    trackingFailed: 'Le modèle de main n’a pas pu être chargé. Rechargez la page.',
    saved: 'Enregistré',
    pinchSaved: 'Sensibilité du pincement enregistrée',
    qualityHigh: 'Qualité élevée',
    qualityFast: 'Mode rapide',
    qualityAuto: 'Mode rapide activé : la scène ne tient pas 30 i/s, le suivi reste fluide.',
    previewOff: 'Aperçu caméra masqué — le suivi des mains reste actif.',
    previewOn: 'Aperçu caméra activé',
    progressReset: 'Progression réinitialisée',
    studySaved: 'Réponses de l’étude enregistrées sur cet appareil.',
    insecureContext:
      'Caméra indisponible : le suivi des mains exige https:// ou localhost. Rechargez via une connexion sécurisée.'
  }
};
