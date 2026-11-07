import type { RawFrame } from '../types';

/**
 * One candidate place to load the wasm runtime and the hand model from.
 * `local` is served from this app's own `public/` folder so Celly stays offline-capable;
 * `cdn` is the pinned CDN fallback used when the local checkout is incomplete.
 */
export interface WorkerAssetSource {
  wasmBase: string;
  modelPath: string;
}

/** Main thread → tracking worker. */
export type TrackingWorkerRequest =
  | {
      type: 'init';
      attempts: WorkerAssetSource[];
    }
  | {
      type: 'frame';
      id: number;
      bitmap: ImageBitmap;
      capturedAt: number;
    }
  | { type: 'dispose' };

/** Tracking worker → main thread. */
export type TrackingWorkerResponse =
  | { type: 'ready'; delegate: 'gpu' | 'cpu'; source: 'local' | 'cdn' }
  | { type: 'result'; id: number; frame: RawFrame; inferenceMs: number }
  | { type: 'error'; id?: number; detail: string; fatal?: boolean };
