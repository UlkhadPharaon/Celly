# 04_BUGS_AND_ISSUES.md — Bug Inventory

## Confirmed Bugs

---

### CELLY-CRIT-001: No error boundary — app crashes silently

| Field | Value |
|---|---|
| **Category** | Reliability / Architecture |
| **Severity** | 🔴 Critical |
| **Confidence** | High (code inspection of main.ts) |
| **Files** | `src/main.ts` (L12-L16) |
| **Expected** | Unhandled exceptions display a recovery UI with retry/reload options |
| **Actual** | Any uncaught exception produces a blank page with no user feedback |
| **Root cause** | Zero error handling at application entry point; no `window.onerror`, no `unhandledrejection` listener |
| **Impact** | Worker init failure, corrupted localStorage, or Three.js renderer crash → dead app |
| **Reproduction** | Inject `throw new Error('test')` in main.ts; white screen |
| **Fix recommended** | Add window-level error handlers + try/catch wrapper + recovery UI overlay |

---

### CELLY-BUG-002: localStorage settings has no schema versioning or corruption defense

| Field | Value |
|---|---|
| **Category** | Data integrity |
| **Severity** | 🟡 Major |
| **Confidence** | Medium |
| **Files** | `src/core/store.ts:L27-L34`, `src/core/app.ts:L1112-L1122` (pattern unchanged despite worker refactor) |
| **Expected** | Stale settings keys discarded when shape doesn't match current types |
| **Actual** | `loadJSON<Partial<Settings>>()` returns whatever was stored; unknown fields merge into settings without validation |
| **Root cause** | No version field in stored data. Key always `celly:v02:settings` regardless of content shape |
| **Impact** | Corrupted or future-version-incompatible settings silently pass through |
| **Fix recommended** | Add `_version` field to Settings; validate/transform on load; sanitize unknown keys |

---

### CELLY-BUG-003: Selection accuracy may still degrade under heavy rendering

| Field | Value |
|---|---|
| **Category** | Picking / Performance |
| **Severity** | 🟠 Medium |
| **Confidence** | Medium |
| **Files** | `src/pages/interactiveLab.ts::pick()`, `src/gestures/aim.ts::nearestWithin()` |
| **Status** | Uncommitted changes moved selection to pinch-start commit, which makes timing less critical (no need for precise aim during hold), but screen-space proximity picking at high DPR still needs verification |
| **Recommendation** | Verify selection test passes at DPR 2.0 after uncommitted changes are committed |

---

### CELLY-BUG-004: Camera retry behavior needs verification with new flow

| Field | Value |
|---|---|
| **Category** | Camera lifecycle |
| **Severity** | 🟡 Major |
| **Confidence** | Medium — new code may have fixed it |
| **Analysis:** The old deadlock (`cameraRequested` flag never reset) pattern may still exist in `app.ts:startCamera()` line 233: `if (this.cameraRequested && this.tracker.camera === 'requesting') return;`. However, the new `HandTracker.start()` implementation uses an `attempt` counter that prevents re-entry, so `startCamera(true)` from a retry button could work if the handler properly resets the attempt counter. The `onRetryCamera` callback exists and calls `startCamera()` but parameterless call means the guard above still applies. **NEEDS REVIEW.** |
| **Recommended fix** | Explicit retry path in `onboarding.ts` should reset `cameraRequested` before calling start |

---

### CELLY-BUG-005: Knowledge graph label overlap

| Field | Value |
|---|---|
| **Category** | UI/UX |
| **Severity** | 🟠 Medium |
| **Files** | `src/scene/knowledgeScene.ts` — label sprite rendering |
| **Unchanged:** Not addressed by recent commits. Still present in HEAD and uncommitted tree. |
| **Fix recommended** | Simple push-out collision avoidance for overlapping labels |

---

### CELLY-BUG-006: EffectComposer resources leak on quality toggle

| Field | Value |
|---|---|
| **Category** | Resource management |
| **Severity** | 🟠 Medium |
| **Files** | `src/scene/sceneManager.ts:setQuality()` |
| **Unchanged:** New effects or changes not applied to quality toggle path. Old render targets accumulate over high→low→high cycles. |
| **Fix recommended** | Dispose composer + rebuild passes on quality switch |

---

## Changes from v0.2.1 Baseline (fb620bd)

### Resolved issues
| ID | Previous Issue | Resolution Status |
|---|---|---|
| Hand pivot/orbit bug (v0.2.x) | GLB armature translation caused wrist offset | **RESOLVED** — replaced by skeleton hand that places joints directly on camera ray |
| Finger retargeting errors (D-46, D-48) | Complex bone mapping with rest calibration failures | **RESOLVED** — skeleton uses direct world landmark positioning, no skin weights needed |
| Selection commit-on-release complexity | Multiple validation steps (hold, travel, frozen aim) added fragility | **CHANGED** — now commits on pinch-start, simpler but different safety profile |
| Thumb joint-angle error (~17°) | GLB thumb rest pose disagreement | **RESOLVED** — skeleton hand bypasses retargeting entirely |
| Heavy GLB download (1.3MB+) | Required asset fetch even for default view | **RESOLVED** — skeleton generated procedurally at runtime, zero assets |

### Potentially introduced regressions
| Area | Risk | Notes |
|---|---|---|
| Selection accuracy | Higher false-positive rate | No hold/travel budget means misfire during finger closure |
| Filter stability | Variable dt from async worker arrival | One-Euro filters may overshoot on large dt gaps |
| Worker init failure | Hard tracking error, no graceful degradation | Worker can fail with fatal error during init |
| CORS dependency | CDN fallback requires external service | WASM runtime falls back to jsDelivr if local folder missing |
