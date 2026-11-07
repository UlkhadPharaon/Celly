# 10_TESTING_AND_VALIDATION_PLAN.md

## Current Test Infrastructure

| Tool | Coverage | Count | Status |
|---|---|---|---|
| Vitest (unit) | Pure logic modules | 91 tests, 9 files | ✅ All passing |
| Playwright (e2e) | Full app with synthetic hands + worker | 3 specs | ⚠️ Browser env required |
- Deleted since v0.2.1: `handMath.test.ts` (was part of GLB rig testing)

### Unit tests that pass (91 total)
pinch.test.ts, handSide.test.ts, gestureEngine.test.ts (modified but passes), device.test.ts, handPoses.test.ts, data.test.ts, cursor.test.ts, aim.test.ts, stores.test.ts

### New e2e specs added (uncommitted)
- `tests/e2e/trackingWorker.spec.ts` — Tests worker init, frame handling, error recovery
- `tests/e2e/overlayPerf.spec.ts` — Tests overlay rendering performance under load

### Tests TO ADD before implementation changes

| Test | Purpose | Type |
|---|---|---|
| Error boundary display + retry flow | Verify error overlay appears on crash | E2E (Playwright) |
| Camera retry resets state | Verify onboarding retry actually calls startCamera again | Unit (app.ts extraction test) |
| Settings schema sanitization | Verify unknown/corrupted settings dropped on load | Unit (`store.ts` extension) |
| Selection accuracy at DPR 2.0 | Verify pick works at high resolution | E2E (override dpr in Playwright) |
| FR translation completeness | Assert every Loc has non-empty `.fr` | Unit (`data.test.ts` extension) |

### Regression testing strategy

After EACH phase:
```bash
npm run typecheck && npm run lint && npm test
npm run build
```
Then manual verification:
- Hand tracking works with real camera (if available)
- Mouse fallback works
- Keyboard shortcuts work
- EN/FR language switching works
- Quality toggle smooth
- Selection test (T key) accurate
