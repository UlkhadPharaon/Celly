# 06_SECURITY_AND_PERFORMANCE.md — Security & Performance Audit

## Security Assessment

### Threat model
Celly is client-side SPA, runs entirely in browser, processes camera frames on-device via WebAssembly. NO network requests after initial page load (except CDN fallback for worker WASM). No authentication, no accounts, no server component. **Threat surface is minimal.**

### S-01: CDN fallback introduces external dependency

**Severity:** 🟡 Low-Medium

`trackingWorker.ts:L16`: `CDN_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm'`

If local wasm folder missing or blocked, worker falls back to jsDelivr CDN. This means:
- External service required for at least one load
- Potential supply-chain risk if jsDelivr is compromised
- CORS requirements must be satisfied by CDN

The model file (`hand_landmarker.task`) remains local-only per comment in `handTracker.ts:L18-L20`. Only WASM runtime can come from CDN.

**Recommendation:** Add integrity check (SRI hash) for CDN assets. Document minimum bandwidth/latency requirements. Consider bundling WASM in production build instead of relying on CDN.

---

### S-02: XSS protection via static templates ✅

All `innerHTML` usage in the app uses hardcoded strings: brand HTML (`shell.ts`), test panel HTML (`interactiveLab.ts`), and project link elements. No user-submitted content flows into any DOM injection point.

However, future extensions adding dynamic content would bypass this protection. Standardize on `textContent` + `escapeHtml()` wrapper going forward.

---

### S-03: Privacy posture excellent ✅

- All processing on-device
- Model files self-hosted after first load
- No analytics, cookies, or tracking scripts
- localStorage scoped to `celly:v02:*` namespace

---

## Performance Analysis

### Current measured performance (from committed code)

| Metric | Status |
|---|---|
| Typecheck | ✅ clean |
| Lint | ✅ clean |
| Unit tests | ✅ 91/91 passing |
| Render FPS target | 60 fps @ 1440×900 (desktop High) |
| Tracking throughput | Worker reports inferenceMs each frame |
| Hand solver latency | Not measured (skeleton hand has no CPU solver — it's just buffer updates) |
| Selection accuracy | 10/10 hits, 0.5 px mean aim error (committed baseline) |

### P-01: Skeleton hand is allocation-free ✅

Unlike GLB rig which had rest-table capture, bone solving, joint limits, and skin weight audit — skeleton hand simply:
1. Copies world landmark positions to Float32Array buffers
2. Populates LineSegmentsGeometry with connection pairs
3. Calls `.needsUpdate = true` on attributes

This is extremely lightweight — essentially a memcpy plus geometry update. The render cost is dominated by THREE.js drawing operations (Points + LineSegments2), not by JS computation.

### P-02: Worker single-flight backpressure ✅

Only one ImageBitmap in flight at a time. If main thread sends frame N while worker is still processing frame N-1, the old result is overwritten by the new one. No queue buildup possible. This guarantees the render loop never blocks waiting for inference.

### P-03: Quality toggle resource leak (W-06 repeated)

When toggling between low/high quality:
- DPR changes but EffectComposer render targets keep original size
- Bloom pass object persists across transitions
- Shadow map resources don't get disposed when shadows disabled
- Dust draw range adjusted but buffer unchanged

Under extended sessions with frequent quality toggling, GPU memory grows until GC intervenes.

**Fix priority: P2**

### P-04: Camera stream resolution fixed at profile-detect time

Camera constraints (width/height/frameRate) set once during device profile detection. Device rotation (phone→tablet landscape) changes profile but doesn't re-open camera. Old constraint persists.

**Fix priority: P3**
