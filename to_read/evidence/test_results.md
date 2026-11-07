# Test Results — Celly v0.2 (at F:/TKS/BUILD/Celly)

## Unit Tests: Vitest 5.0.4

**Date:** 2026-11-07
**Command:** `npx vitest run`

```
 RUN  v5.0.4 F:/TKS/BUILD/Celly
 Test Files  9 passed (9)
      Tests  91 passed (91)
   Duration  1.53s
```

### Breakdown
| File | Category | Status |
|---|---|---|
| pinch.test.ts | Pinch value, hysteresis, fist rejection | PASS |
| handSide.test.ts | Side resolution, label flip, debounce | PASS |
| gestureEngine.test.ts | State machine, transitions | PASS |
| device.test.ts | Phone/tablet/desktop classification | PASS |
| handPoses.test.ts | Deterministic landmark generation | PASS |
| data.test.ts | Content minimums, integrity checks | PASS |
| cursor.test.ts | Cursor mapping utilities | PASS |
| aim.test.ts | Aim look-back, proximity matching | PASS |
| stores.test.ts | Reactive store, localStorage helpers | PASS |

**Note:** Down from 101 tests in v0.2.1. `tests/unit/handMath.test.ts` deleted along with `handRig.ts`, `lowPolyHand.ts`, and `handMath.ts` after skeleton hand replaced GLB approach. The hand retargeting tests are no longer relevant since skeleton hand has no bone solver or skin weight computation.

## E2E Tests: Playwright 1.64.0

**Status:** Not executed this session (requires browser/Playwright). Three spec files exist:
- `smoke.spec.ts` — app boot, navigation, i18n
- `gestures.spec.ts` — synthetic-hand replay for selection, knowledge focus, scale
- `trackingWorker.spec.ts` — NEW: worker init, frame handling
- `overlayPerf.spec.ts` — NEW: overlay rendering performance
