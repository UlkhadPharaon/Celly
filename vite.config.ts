import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    strictPort: false,
    host: 'localhost',
    headers: {
      // Cross-origin isolation unlocks SharedArrayBuffer, which the MediaPipe WASM runtime needs
      // to run inference on multiple WebAssembly threads (one per core) instead of a single
      // thread. `credentialless` (not `require-corp`) keeps the jsDelivr WASM fallback loadable
      // without a CORP header while still enabling SharedArrayBuffer.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless'
    }
  },
  worker: {
    format: 'es'
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/@mediapipe')) return 'mediapipe';
          return undefined;
        }
      }
    }
  }
});
