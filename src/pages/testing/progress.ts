import { loadJSON, saveJSON } from '../../core/store';

const KEY = 'celly:v02:progress';

export interface ProgressData {
  /** Best correct-ratio per quiz key, 0..1. */
  best: Record<string, number>;
  attempts: number;
  lastPlayed: number;
}

export function gradeRatio(ratio: number): 'A' | 'B' | 'C' | 'D' {
  if (ratio >= 0.9) return 'A';
  if (ratio >= 0.75) return 'B';
  if (ratio >= 0.6) return 'C';
  return 'D';
}

export function scoreLabel(ratio: number): string {
  if (ratio >= 0.95) return 'Flawless';
  if (ratio >= 0.85) return 'Excellent';
  if (ratio >= 0.7) return 'Solid';
  if (ratio >= 0.5) return 'Getting there';
  return 'Keep going';
}

export class ProgressStore {
  private data: ProgressData;

  constructor() {
    const raw = loadJSON<Partial<ProgressData>>(KEY, {});
    this.data = {
      best: raw.best && typeof raw.best === 'object' ? raw.best : {},
      attempts: Number(raw.attempts) || 0,
      lastPlayed: Number(raw.lastPlayed) || 0
    };
  }

  best(key: string): number {
    return this.data.best[key] ?? 0;
  }

  record(key: string, ratio: number): void {
    this.data.best[key] = Math.max(this.data.best[key] ?? 0, ratio);
    this.data.attempts += 1;
    this.data.lastPlayed = Date.now();
    saveJSON(KEY, this.data);
  }

  get attempts(): number {
    return this.data.attempts;
  }

  reset(): void {
    this.data = { best: {}, attempts: 0, lastPlayed: 0 };
    saveJSON(KEY, this.data);
  }
}
