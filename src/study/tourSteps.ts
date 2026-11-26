/**
 * Content of the guided tour: what each region of the interface is for, in the vocabulary of the
 * interaction mode the participant chose.
 *
 * A step only exists if it has an anchor (`[data-tour="…"]`) currently in the DOM, so the same
 * list works on every page and in the text-only surface: missing regions are simply skipped.
 */

import type { Loc } from '../types';
import type { InteractionMode } from './types';

export interface TourStepCopy {
  title: Loc;
  body: Loc;
  /** Optional one-line "try this" nudge, shown as the card's footer. */
  action?: Loc;
}

export interface TourStep {
  id: string;
  /** CSS selector for the highlighted region, or '' for a centred card. */
  anchor: string;
  /** Copy shared by every mode. */
  all?: TourStepCopy;
  /** Copy that replaces `all` in this mode. */
  hands?: TourStepCopy;
  mouse?: TourStepCopy;
  text?: TourStepCopy;
  /** Restrict the step to these modes; omitted means every mode. */
  modes?: InteractionMode[];
}

function pick(step: TourStep, mode: InteractionMode): TourStepCopy | null {
  const copy = step[mode] ?? step.all;
  if (!copy) return null;
  return {
    title: copy.title,
    body: copy.body,
    action: copy.action
  };
}

/** Steps resolved for a mode, in order, with the mode filter applied. */
export function tourStepsFor(mode: InteractionMode): TourStep[] {
  return STEPS.filter((step) => !step.modes || step.modes.includes(mode));
}

export function copyFor(step: TourStep, mode: InteractionMode): TourStepCopy | null {
  return pick(step, mode);
}

const WELCOME: TourStep = {
  id: 'welcome',
  anchor: '',
  all: {
    title: { en: 'What Celly is for', fr: 'À quoi sert Celly' },
    body: {
      en: 'A cell is far too small to look around inside. Celly rebuilds one at full scale so you can walk around it, take a part in your hands and read what that part actually does. Learn the material first, then prove it on a quiz, then tell us how it felt — that last part is the experiment.',
      fr: 'Une cellule est bien trop petite pour la visiter de l’intérieur. Celly en reconstruit une à grande échelle : vous pouvez en faire le tour, prendre une pièce entre les mains et lire ce qu’elle fait vraiment. Apprenez le contenu, prouvez-le avec un quiz, puis dites-nous ce que vous avez ressenti — c’est cette dernière partie qui constitue l’expérience.'
    }
  }
};

const TABS: TourStep = {
  id: 'tabs',
  anchor: '[data-tour="tabs"]',
  all: {
    title: { en: 'The three sections', fr: 'Les trois sections' },
    body: {
      en: 'Interactive puts the cell itself in front of you. Knowledge is the same content as a map of linked concepts. Test is where you prove what stuck — and where the study quiz you must finish lives.',
      fr: 'Laboratoire place la cellule elle-même devant vous. Savoirs présente le même contenu sous forme de carte de concepts liés. Test est l’endroit où vous prouvez ce qui est resté — et où se trouve le quiz de l’étude que vous devez terminer.'
    },
    action: { en: 'Keys 1 · 2 · 3 jump between them.', fr: 'Les touches 1 · 2 · 3 passent de l’une à l’autre.' }
  }
};

const STAGE: TourStep = {
  id: 'stage',
  anchor: '[data-tour="stage"]',
  hands: {
    title: { en: 'The cell — and your hands', fr: 'La cellule — et vos mains' },
    body: {
      en: 'Everything here is driven by one gesture: pinch your thumb and index finger together. Pinch an organelle to select it, pinch empty space to step back, pinch and drag with your left hand to rotate, spread both hands to scale.',
      fr: 'Tout ici repose sur un seul geste : pincez le pouce et l’index ensemble. Pincez un organite pour le sélectionner, pincez le vide pour revenir, pincez et glissez avec la main gauche pour tourner, écartez les deux mains pour l’échelle.'
    },
    action: { en: 'Keep your hands inside the frame, 60–80 cm away.', fr: 'Gardez les mains dans le cadre, à 60–80 cm.' }
  },
  mouse: {
    title: { en: 'The cell — with a mouse', fr: 'La cellule — à la souris' },
    body: {
      en: 'Drag to rotate the model, scroll to move closer, click an organelle to select it. The camera stays off in this mode: every control the hand version has is reachable from the mouse.',
      fr: 'Glissez pour tourner le modèle, molettez pour vous rapprocher, cliquez sur un organite pour le sélectionner. La caméra reste éteinte dans ce mode : toutes les commandes de la version mains sont accessibles à la souris.'
    },
    action: { en: 'Drag to rotate, scroll to zoom, click a part to select it.', fr: 'Glissez pour tourner, molettez pour zoomer, cliquez sur une pièce pour la sélectionner.' }
  }
};

const STRUCTURE: TourStep = {
  id: 'structure',
  anchor: '[data-tour="structure"]',
  modes: ['hands', 'mouse'],
  all: {
    title: { en: 'Every part of the cell', fr: 'Chaque pièce de la cellule' },
    body: {
      en: 'The rail lists all fifteen organelles. Selecting one pauses the cell, opens a card with its function, its structure and a fact worth remembering, and links it to the knowledge map.',
      fr: 'Le rail liste les quinze organites. En sélectionner un met la cellule en pause, ouvre une carte avec sa fonction, sa structure et un fait à retenir, et le relie à la carte des savoirs.'
    }
  }
};

const HUD: TourStep = {
  id: 'hud',
  anchor: '[data-tour="hud"]',
  modes: ['hands'],
  hands: {
    title: { en: 'Is it seeing you?', fr: 'Vous voit-il ?' },
    body: {
      en: 'Live tracking health: how many hands are in frame, how steady they are, how fast the camera and the inference run. If this says “poor”, step back into the light and the pinch will get crisper.',
      fr: 'État du suivi en direct : combien de mains sont dans le cadre, leur stabilité, la vitesse de la caméra et de l’inférence. Si c’est indiqué « faible », reculez dans la lumière et le pincement deviendra plus net.'
    }
  }
};

const LEGEND: TourStep = {
  id: 'legend',
  anchor: '[data-tour="legend"]',
  modes: ['hands'],
  all: {
    title: { en: 'The four gestures', fr: 'Les quatre gestes' },
    body: {
      en: 'Select a part with a right pinch, click a button the same way, rotate with the left hand, scale with both. That is the whole vocabulary — nothing is hidden behind a menu.',
      fr: 'Sélectionnez une pièce d’une pincement droit, cliquez un bouton de la même façon, tournez avec la main gauche, changez l’échelle avec les deux. C’est tout le vocabulaire — rien n’est caché dans un menu.'
    }
  }
};

const CONTROLS: TourStep = {
  id: 'controls',
  anchor: '[data-tour="controls"]',
  all: {
    title: { en: 'Settings and privacy', fr: 'Réglages et confidentialité' },
    body: {
      en: 'Camera, mirroring, pinch sensitivity, language and quality. Nothing leaves the device: the webcam feed is processed locally and never uploaded.',
      fr: 'Caméra, miroir, sensibilité du pincement, langue et qualité. Rien ne quitte l’appareil : le flux de la webcam est traité localement et jamais envoyé.'
    },
    action: { en: 'L switches the interface language.', fr: 'L change la langue de l’interface.' }
  }
};

const HELP: TourStep = {
  id: 'help',
  anchor: '[data-tour="help"]',
  all: {
    title: { en: 'Help, any time', fr: 'Aide, à tout moment' },
    body: {
      en: 'This button replays the gesture reference and every keyboard shortcut. Pressing H or ? does the same thing from anywhere in the app.',
      fr: 'Ce bouton réaffiche la référence des gestes et tous les raccourcis clavier. La touche H ou ? fait la même chose depuis n’importe où.'
    }
  }
};

const RESEARCH: TourStep = {
  id: 'research',
  anchor: '[data-tour="research"]',
  all: {
    title: { en: 'The study data', fr: 'Les données de l’étude' },
    body: {
      en: 'Everything you do here is recorded as an anonymous participant profile: your mode, your reading time, your quiz answers and your ratings. This button shows those profiles and exports them, so the three ways of learning can be compared afterwards.',
      fr: 'Tout ce que vous faites ici est enregistré dans un profil de participant anonyme : votre mode, votre temps de lecture, vos réponses au quiz et vos évaluations. Ce bouton affiche ces profils et les exporte, afin de comparer ensuite les trois façons d’apprendre.'
    }
  }
};

const TEXTBOOK_STEPS: TourStep[] = [
  {
    id: 'text-toc',
    anchor: '[data-tour="text-toc"]',
    modes: ['text'],
    text: {
      title: { en: 'The chapters', fr: 'Les chapitres' },
      body: {
        en: 'Eight chapters, from the membrane to the cytoskeleton. Read them in order or jump straight to a part you want — the quiz at the end draws from all of them.',
        fr: 'Huit chapitres, de la membrane au cytosquelette. Lisez-les dans l’ordre ou sautez directement à la pièce qui vous intéresse — le quiz final puise dans tous les chapitres.'
      }
    }
  },
  {
    id: 'text-body',
    anchor: '[data-tour="text-body"]',
    modes: ['text'],
    text: {
      title: { en: 'A page, not a toy', fr: 'Une page, pas un jouet' },
      body: {
        en: 'No 3D, no camera, no colour-coded blobs: the same content written as a textbook, with figures described in words. Figures in words are slower to read and harder to picture — that difference is exactly what the study measures.',
        fr: 'Pas de 3D, pas de caméra, pas de pastilles colorées : le même contenu écrit comme un manuel, les figures décrites en mots. Les figures en mots sont plus lentes à lire et plus difficiles à imaginer — c’est précisément cette différence que l’étude mesure.'
      },
      action: { en: 'Your reading time is being timed.', fr: 'Votre temps de lecture est chronométré.' }
    }
  }
];

const FINAL: TourStep = {
  id: 'final',
  anchor: '',
  all: {
    title: { en: 'You are set', fr: 'Vous êtes prêt' },
    body: {
      en: 'Explore, learn, then take the quiz and the short survey at the end. Your answers become one anonymous profile that can be compared with everyone else’s.',
      fr: 'Explorez, apprenez, puis passez le quiz et le court questionnaire de fin. Vos réponses deviennent un profil anonyme comparable à celui des autres.'
    },
    action: { en: 'The quiz and survey are always at the end.', fr: 'Le quiz et le questionnaire sont toujours à la fin.' }
  }
};

interface TourStepFull extends TourStep {}

const STEPS: TourStepFull[] = [
  WELCOME,
  TABS,
  STAGE,
  STRUCTURE,
  HUD,
  LEGEND,
  CONTROLS,
  HELP,
  ...TEXTBOOK_STEPS,
  RESEARCH,
  FINAL
];