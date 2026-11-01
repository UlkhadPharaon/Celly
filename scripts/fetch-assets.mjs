// Prepares the local-only runtime assets:
//  1. copies the MediaPipe wasm files out of the pinned npm package into /public
//  2. downloads hand_landmarker.task (offline inference, no CDN)
//  3. removes stale hand mesh assets so the deployed bundle stays small
// Idempotent: skips anything already present at the expected size.
import { cpSync, existsSync, mkdirSync, statSync, createWriteStream, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get } from 'node:https';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDst = join(root, 'public', 'mediapipe-wasm');
const modelDst = join(root, 'public', 'models', 'hand_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

mkdirSync(wasmDst, { recursive: true });
mkdirSync(dirname(modelDst), { recursive: true });

// 1) wasm files — keep original names (FilesetResolver relies on them)
if (!existsSync(wasmSrc)) {
  console.warn('[fetch-assets] @mediapipe/tasks-vision wasm dir not found — did npm install finish?');
  process.exit(0);
}
let copied = 0;
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm',
                 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm',
                 'vision_wasm_simd_internal.js', 'vision_wasm_simd_internal.wasm',
                 'vision_wasm_simd_mt_internal.js', 'vision_wasm_simd_mt_internal.wasm']) {
  const src = join(wasmSrc, f);
  if (existsSync(src)) { cpSync(src, join(wasmDst, f)); copied++; }
}
console.log(`[fetch-assets] ${copied} wasm files -> public/mediapipe-wasm`);

// 2) model (~7.5 MB) — download once, keep if present
if (existsSync(modelDst) && statSync(modelDst).size > 1_000_000) {
  console.log('[fetch-assets] hand_landmarker.task already present, skipping');
} else {
  console.log('[fetch-assets] downloading hand_landmarker.task ...');
  const dl = (url, redirects) => {
    get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        if (redirects > 5) { console.error('[fetch-assets] too many redirects'); process.exitCode = 0; return; }
        dl(res.headers.location, redirects + 1);
        return;
      }
      if (res.statusCode !== 200) {
        console.error(`[fetch-assets] model download failed HTTP ${res.statusCode} — app will fall back to CDN`);
        process.exitCode = 0; return;
      }
      const out = createWriteStream(modelDst);
      res.pipe(out);
      out.on('finish', () => { out.close();
        console.log(`[fetch-assets] model ${(statSync(modelDst).size / 1e6).toFixed(1)} MB -> public/models/`); });
      out.on('error', (e) => console.error('[fetch-assets] write error', e.message));
    }).on('error', (e) => {
      console.error(`[fetch-assets] model download error (${e.message}) — app will fall back to CDN`);
    });
  };
  dl(MODEL_URL, 0);
}

// 3) Legacy hand meshes are intentionally not copied. Hands render as a lightweight skeleton, so
//    the 9 MB of hands_*.glb assets stay out of the deploy bundle.
const publicDir = join(root, 'public');
for (const f of readdirSync(publicDir)) {
  if (!f.startsWith('hands_') || !f.endsWith('.glb')) continue;
  try {
    rmSync(join(publicDir, f));
    console.log(`[fetch-assets] removed stale mesh public/${f}`);
  } catch {
    /* locked — harmless, nothing imports it */
  }
}
