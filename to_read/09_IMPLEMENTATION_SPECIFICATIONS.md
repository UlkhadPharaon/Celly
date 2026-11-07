# 09_IMPLEMENTATION_SPECIFICATIONS.md

## SPEC-01: Error Boundaries (CELLY-CRIT-001 / P0)

**Files:** New `src/ui/errorBoundary.ts`, modify `src/main.ts`

Create an `ErrorBoundary` class that renders a DOM overlay with error message, technical details (collapsible), and two buttons: "Retry" (re-initialize app) and "Reload page". Positioned above all UI. Stores `celly:v02:error-boundary-dismissed` flag for retry logic.

In `main.ts`:
```typescript
try {
  const app = new CellyApp(mount);
  app.start();
  window.__celly = app;
} catch (err) {
  showErrorBoundary(err instanceof Error ? err.message : String(err));
}
window.addEventListener('error', (e) => {
  if (!document.querySelector('.error-boundary')) showErrorBoundary(e.error?.message ?? 'Unknown error');
});
window.addEventListener('unhandledrejection', (e) => {
  if (!document.querySelector('.error-boundary')) showErrorBoundary(String(e.reason));
});
```

Internal CellyApp failures should degrade gracefully: HandTracker failure → switch to mouse mode; SceneManager constructor failure → show recovery UI.

---

## SPEC-02: localStorage Schema Versioning (CELLY-BUG-002 / P1)

**Files:** Modify `src/types.ts`, `src/core/app.ts`

Add `_version?: number` to Settings interface. On load, validate/transform known fields, discard unknown keys by reconstructing from default schema. Save with current version number. Future versions can add migration logic based on version comparison.

---

## SPEC-03: Camera Retry Verification/Fix (CELLY-BUG-004 / P1)

**Files:** Modify `src/core/app.ts:startCamera()`, `src/ui/onboarding.ts`

Test that onboarding's "enable camera" flow actually works after a failed attempt. The guard in `startCamera()` at L233 may block retries. Either reset `cameraRequested` when user explicitly chooses to retry via onboarding, or change the guard to check tracker state rather than just the flag.

---

## SPEC-04: Visual Selection Feedback (UX-005 / P2)

**Files:** Modify `src/gestures/gestureEngine.ts`, `src/scene/cellModel.ts`

After selection commits on pinch-start, add a brief visual pulse on the target organelle using the existing halo shader. Show it for ~150ms to give users confirmatory feedback before the selection settles. This replaces the lost hold-time visual cue.

---

## SPEC-05: Quality Toggle Resource Cleanup (W-06 / P2)

**Files:** Modify `src/scene/sceneManager.ts:setQuality()`

Before changing quality mode, dispose the existing EffectComposer and its passes. Recreate composer with new DPR-appropriate render targets. Proper shadow map disposal when shadows disabled.

---

## SPEC-06: Update DECISIONS.md for Worker Architecture (R-01 / P3)

**Files:** Modify `DECISIONS.md`

Mark D-12 as superseded. Add new entry documenting Web Worker rationale: off-main-thread inference prevents render loop stalls, single-flight backpressure guarantees no frame queuing, skeleton hand eliminated CPU retarget solver making worker transfer overhead acceptable vs main-thread benefit.
