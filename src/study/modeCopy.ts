/** Display names of the three study conditions, shared by the gate, the tour and the exports. */
import type { Language } from '../types';
import type { InteractionMode } from './types';

export const MODE_COPY: Record<
  Language,
  Record<InteractionMode, { title: string; short: string; description: string }>
> = {
  en: {
    hands: {
      title: 'Hand tracking',
      short: 'Hands · webcam',
      description: 'The 3D cell, controlled with bare-hand pinches through the webcam.'
    },
    mouse: {
      title: 'Mouse',
      short: 'Mouse · 3D',
      description: 'The same 3D cell, controlled with clicks and dragging. No camera.'
    },
    text: {
      title: 'Textbook',
      short: 'Reading · no 3D',
      description: 'The same material as a written textbook page. No 3D, no camera.'
    }
  },
  fr: {
    hands: {
      title: 'Suivi des mains',
      short: 'Mains · webcam',
      description: 'La cellule 3D, pilotée par pincements à mains nues via la webcam.'
    },
    mouse: {
      title: 'Souris',
      short: 'Souris · 3D',
      description: 'La même cellule 3D, pilotée par clics et glissements. Sans caméra.'
    },
    text: {
      title: 'Manuel',
      short: 'Lecture · sans 3D',
      description: 'Le même contenu sous forme de page de manuel. Sans 3D, sans caméra.'
    }
  }
};