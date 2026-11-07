import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { RawHand, Vec3 } from '../types';
import type { TrackingWorkerRequest, TrackingWorkerResponse } from './trackingProtocol';

/** `WasmFileset` is declared but not exported by the package; derive it from the resolver. */
type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

const scope = self as unknown as DedicatedWorkerGlobalScope;

let landmarker: HandLandmarker | null = null;
let initGeneration = 0;
let lastTimestamp = 0;

function post(message: TrackingWorkerResponse): void {
  scope.postMessage(message);
}

function toVec3(p: { x: number; y: number; z: number }): Vec3 {
  return { x: p.x, y: p.y, z: p.z };
}

function toRawHands(result: HandLandmarkerResult): RawHand[] {
  const hands: RawHand[] = [];
  for (let i = 0; i < result.landmarks.length; i++) {
    const cat = result.handedness[i]?.[0];
    hands.push({
      handedness: (cat?.categoryName as RawHand['handedness']) ?? 'Unknown',
      score: cat?.score ?? 0,
      landmarks: result.landmarks[i].map(toVec3),
      // MediaPipe world space is metric but image-aligned: x right, y down, z negative
      // towards the camera. Convert once, here, to the renderer's y-up / +z-towards-viewer
      // frame so the main thread never has to know the tracker's convention.
      worldLandmarks: (result.worldLandmarks[i] ?? []).map((p) => ({ x: p.x, y: -p.y, z: -p.z }))
    });
  }
  return hands;
}

async function createForDelegate(
  vision: VisionFileset,
  modelPath: string,
  preference: 'GPU' | 'CPU'
): Promise<HandLandmarker> {
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelPath, delegate: preference },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
}

/**
 * Load the hand model, trying GPU first and falling back to CPU in the same worker.
 *
 * GPU inference here runs on an OffscreenCanvas-backed WebGL context, so the wasm glue needs
 * no DOM. Each attempt closes and discards its landmarker before the next one is built, because
 * the wasm runtime clears `self.ModuleFactory` after a successful load.
 */
async function init(request: Extract<TrackingWorkerRequest, { type: 'init' }>): Promise<void> {
  const generation = ++initGeneration;
  landmarker?.close();
  landmarker = null;

  let lastError = '';
  for (let i = 0; i < request.attempts.length; i++) {
    const attempt = request.attempts[i];
    try {
      const vision = await FilesetResolver.forVisionTasks(attempt.wasmBase);
      for (const preference of ['GPU', 'CPU'] as const) {
        try {
          const next = await createForDelegate(vision, attempt.modelPath, preference);
          if (generation !== initGeneration) {
            next.close();
            return;
          }
          landmarker = next;
          post({
            type: 'ready',
            delegate: preference === 'GPU' ? 'gpu' : 'cpu',
            source: i === 0 ? 'local' : 'cdn'
          });
          return;
        } catch (err) {
          lastError = `${preference}: ${(err as Error)?.message ?? String(err)}`;
        }
      }
    } catch (err) {
      lastError = `${attempt.wasmBase}: ${(err as Error)?.message ?? String(err)}`;
    }
  }

  if (generation === initGeneration) {
    post({
      type: 'error',
      detail: lastError || 'The hand model could not be loaded in the tracking worker.',
      fatal: true
    });
  }
}

function detect(id: number, bitmap: ImageBitmap, capturedAt: number): void {
  if (!landmarker) {
    bitmap.close();
    post({ type: 'error', id, detail: 'The worker received a frame before the model was ready.' });
    return;
  }

  const startedAt = performance.now();
  // MediaPipe requires strictly increasing timestamps. performance.now() is monotonic, but a
  // timer clamp can repeat it; nudge forward instead of letting the task reject the frame.
  let timestamp = performance.now();
  if (timestamp <= lastTimestamp) timestamp = lastTimestamp + 0.001;
  lastTimestamp = timestamp;

  try {
    const result = landmarker.detectForVideo(bitmap, timestamp);
    post({
      type: 'result',
      id,
      frame: { hands: toRawHands(result), tMs: capturedAt },
      inferenceMs: performance.now() - startedAt
    });
  } catch (err) {
    post({
      type: 'error',
      id,
      detail: `Hand inference failed: ${(err as Error)?.message ?? String(err)}`
    });
  } finally {
    bitmap.close();
  }
}

/**
 * MediaPipe's wasm loader prefers `importScripts`, and otherwise injects a DOM `<script>` that
 * cannot exist in a worker. Vite ships this worker as an ES module, where `importScripts` is not
 * defined, so install a synchronous-XHR equivalent. The wasm glue is a classic script whose only
 * job is to set `self.ModuleFactory`, so evaluating it in global scope is enough.
 */
function installImportScriptsShim(): void {
  const host = self as unknown as { importScripts?: (...urls: string[]) => void };
  // A module worker still reports `importScripts` as a function on the prototype, but calling it
  // always throws ("Module scripts don't support importScripts"). Install an own property that
  // shadows it with a XHR + indirect-eval equivalent: the wasm glue is a classic script whose
  // only job is to set `self.ModuleFactory`.
  host.importScripts = (...urls: string[]) => {
    for (const url of urls) {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send(null);
      if (xhr.status < 200 || xhr.status >= 300) {
        throw new TypeError(`Could not load the MediaPipe wasm runtime (${xhr.status}).`);
      }
      // Indirect eval: the glue's `var ModuleFactory` must land on the worker global, exactly
      // as classic-script semantics would.
      (0, eval)(xhr.responseText);
    }
  };
}

scope.onmessage = (event: MessageEvent<TrackingWorkerRequest>): void => {
  const request = event.data;
  switch (request.type) {
    case 'init':
      installImportScriptsShim();
      void init(request);
      break;
    case 'frame':
      detect(request.id, request.bitmap, request.capturedAt);
      break;
    case 'dispose':
      initGeneration++;
      landmarker?.close();
      landmarker = null;
      scope.close();
      break;
    default:
      break;
  }
};
