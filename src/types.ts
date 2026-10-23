// Shared domain types. Kept DOM-free so every pure module stays unit-testable.

export type Language = 'en' | 'fr';
export type PageId = 'interactive' | 'knowledge' | 'test';
export type HandSide = 'left' | 'right';
export type QualityMode = 'low' | 'high';

export interface Vec2 {
  x: number;
  y: number;
}
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Localized string. EN is required, FR optional (falls back to EN). */
export interface Loc {
  en: string;
  fr?: string;
}
export interface LocList {
  en: string[];
  fr?: string[];
}

export type OrganelleId =
  | 'membrane'
  | 'cytoplasm'
  | 'nucleus'
  | 'nuclear-envelope'
  | 'nucleolus'
  | 'mitochondrion'
  | 'rough-er'
  | 'smooth-er'
  | 'golgi'
  | 'ribosome'
  | 'lysosome'
  | 'vacuole'
  | 'centriole'
  | 'cytoskeleton'
  | 'peroxisome';

export interface OrganelleMeta {
  id: string;
  name: Loc;
  shortDescription: Loc;
  function: LocList;
  structure: Loc;
  funFact: Loc;
  relatedIds: string[];
  /** Hex string, e.g. "#7b5cff". */
  color: string;
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

export interface RawHand {
  handedness: 'Left' | 'Right' | 'Unknown';
  /** Detection/presence confidence 0..1. */
  score: number;
  /** 21 landmarks in normalized image space (0..1, origin top-left). */
  landmarks: Vec3[];
  /** 21 world landmarks in metres, origin at the hand centre. */
  worldLandmarks: Vec3[];
}

export interface RawFrame {
  hands: RawHand[];
  tMs: number;
}

export interface HandFrame {
  side: HandSide;
  present: boolean;
  /** Hysteresis-filtered pinch state. */
  pinching: boolean;
  /** 0..1, 1 = fully pinched. */
  pinchValue: number;
  pinchStart: boolean;
  pinchEnd: boolean;
  /** Screen-space pinch cursor in CSS pixels. */
  cursor: Vec2;
  /** Same cursor in normalized device coordinates. */
  cursorNdc: Vec2;
  /** Screen-space middle-MCP palm point, used for rotate deltas. */
  palm: Vec2;
  /** Filtered normalized landmarks. */
  landmarks: Vec3[];
  /** Filtered world landmarks (metres). */
  world: Vec3[];
  handScale: number;
  wrist: Vec3;
  /** In-plane roll angle, radians. */
  roll: number;
  tMs: number;
}

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'live'
  | 'denied'
  | 'not-found'
  | 'in-use'
  | 'insecure-context'
  | 'unsupported';

export type TrackingStatus = 'idle' | 'initializing' | 'gpu' | 'cpu' | 'error';

// ---------------------------------------------------------------------------
// Gestures
// ---------------------------------------------------------------------------

export type GestureState = 'IDLE' | 'HOVER_UI' | 'SELECTING' | 'ROTATING' | 'SCALING' | 'SWIPING' | 'COOLDOWN';

export type Intent =
  | { type: 'select'; id: string }
  | { type: 'unselect' }
  | { type: 'click'; id: string }
  | { type: 'hover'; id: string | null; kind: 'ui' | 'scene' }
  | { type: 'rotate'; dx: number; dy: number }
  | { type: 'scale'; factor: number; delta: number }
  | { type: 'swipe'; direction: 'left' | 'right'; progress: number; phase: 'move' | 'end' }
  | { type: 'state'; state: GestureState; hint: string };

export interface GestureContext {
  t: number;
  hands: HandFrame[];
  /** Interactive DOM button id under the primary cursor, if any. */
  uiHover: string | null;
  /** Scene object id under the primary cursor, if any. */
  sceneHover: string | null;
  swipeEnabled: boolean;
  rotateEnabled: boolean;
  scaleEnabled: boolean;
  dwellEnabled: boolean;
}

export interface GestureFrame {
  state: GestureState;
  hint: string;
  /** 0..1 dwell progress toward the current UI target. */
  dwellProgress: number;
  intents: Intent[];
  cursors: Array<{
    side: HandSide;
    x: number;
    y: number;
    visible: boolean;
    active: boolean;
    pinchValue: number;
    mode: 'pointer' | 'pinch' | 'passive';
  }>;
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export type KnowledgeCategory = 'Organelles' | 'Processes' | 'Molecules' | 'Cell types';

export interface KnowledgeNode {
  id: string;
  label: Loc;
  category: KnowledgeCategory;
  summary: Loc;
  details: LocList;
  color: string;
  /** 1..5 importance, drives sphere radius. */
  size: number;
  links: string[];
  organelleId?: string;
  quizIds?: string[];
}

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Question {
  id: string;
  question: Loc;
  options: Loc[];
  answerIndex: number;
  explanation: Loc;
  category: string;
  difficulty: Difficulty;
  linkedIds: string[];
}

export interface Flashcard {
  id: string;
  front: Loc;
  back: Loc;
  category: string;
  linkedIds: string[];
}

export interface QuestionnaireSet {
  id: string;
  title: Loc;
  description: Loc;
  questionIds: string[];
}

// ---------------------------------------------------------------------------
// Settings & persisted state
// ---------------------------------------------------------------------------

export interface Settings {
  language: Language;
  mirrorX: boolean;
  mirrorY: boolean;
  handsSwap: boolean;
  showWebcam: boolean;
  showFeedback: boolean;
  dwellClick: boolean;
  autoRotate: boolean;
  /** Multiplier on the pinch mapping: <1 needs a tighter pinch, >1 accepts a looser one. */
  pinchSensitivity: number;
  reducedMotion: boolean;
  highContrast: boolean;
  quality: QualityMode;
}

export type LeitnerBox = 1 | 2 | 3 | 4 | 5;

export interface FlashcardState {
  box: LeitnerBox;
  lastSeen: number;
  correct: number;
  wrong: number;
}

export interface TrackingQuality {
  level: 'good' | 'medium' | 'poor' | 'none';
  value: number; // 0..1
  jitter: number;
  margin: number;
}
