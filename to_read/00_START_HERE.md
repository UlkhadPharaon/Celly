# 00_START_HERE.md — Celly v0.2 Deep Codebase Audit & Engineering Handoff

## Mission brief

This audit covers **Celly v0.2** at `F:/TKS/BUILD/Celly`, HEAD commit `4a17a1d` with significant uncommitted work-in-progress (~620 lines modified across 13 files, 4 new files).

The previous v0.2.1 baseline (`fb620bd`) had already shipped hand tracking via main-thread MediaPipe inference and a skeletal hand overlay. Since then, three major architectural shifts occurred:

1. **Hand inference moved to a Web Worker** — contradicts DECISIONS.md D-12 ("Tracking on the main thread, not a worker")
2. **Selection semantics simplified** — commits on pinch-start instead of release; hold time and travel budget removed
3. **GLB hand rig deleted** — replaced by lightweight `skeletonHand.ts` (lines/points overlay)

---

## Read order

| Step | Document | Why |
|---|---|---|
| 1 | This file | Overview and status |
| 2 | `01_PROJECT_OVERVIEW.md` | What Celly is, tech stack, current state |
| 3 | `08_IMPROVEMENT_ROADMAP.md` | Prioritized fixes (P0→P3) |
| 4 | `RAW_CODING_AGENT_PROMPT.md` | Master prompt for implementation agent |
| 5 | `04_BUGS_AND_ISSUES.md` | All confirmed bugs with IDs |
| 6 | `09_IMPLEMENTATION_SPECIFICATIONS.md` | Technical specs for each fix |

Then read supporting docs as needed:
- `02_ARCHITECTURE_AUDIT.md` — architecture breakdown + weaknesses
- `03_EGM_AUDIT_REPORT.md` — EGM Goldfish review
- `05_UX_AND_PRODUCT_AUDIT.md` — UX problems
- `06_SECURITY_AND_PERFORMANCE.md` — security/performance
- `07_REQUIREMENTS_AND_MISUNDERSTANDINGS.md` — requirement gaps
- `10_TESTING_AND_VALIDATION_PLAN.md` — testing strategy
- `11_AGENT_EXECUTION_GUIDE.md` — how the coding agent should execute
- `12_FINAL_AUDIT_SUMMARY.md` — executive summary

---

## Top-line assessment

**Celly v0.2 is a well-engineered application currently undergoing a major refactoring cycle.** The committed code (HEAD) plus uncommitted work represents a transition from a GLB-mesh hand model to a lightweight skeleton overlay, from main-thread to worker-thread inference, and from careful release-commit gesture semantics to simplified pinch-start commits.

### What's strong
- Clean separation of pure logic (gesture engine, pinch detection, side resolution) from DOM/Three.js
- Deterministic force layout, allocation-free render loop scratch vectors
- Comprehensive test suite: 91 unit tests pass, typecheck clean, lint clean
- 54+ documented architectural decisions (DECISIONS.md)
- Real-device selection test passes (10/10, 0.5 px mean aim error at HEAD)
- Bilingual EN/FR, accessible, responsive down to mobile
- No framework overhead — custom ~60-line reactive store replaces React/Vue

### Critical problems needing fixes (NOT resolved by recent changes)

| Severity | ID | Problem | Status |
|---|---|---|---|
| 🔴 Critical | CELLY-CRIT-001 | No error boundary — any crash kills the entire app silently | NOT FIXED |
| 🟡 Major | CELLY-BUG-002 | localStorage settings has no schema versioning or corruption defense | NOT FIXED |
| 🟡 Major | CELLY-BUG-004 | Camera retry may deadlock depending on flow path | PENDING CHECK |
| 🟠 Medium | CELLY-UX-001 | Knowledge graph label overlap on tablets | NOT FIXED |
| 🟠 Medium | CELLY-PERF-001 | EffectComposer resources don't dispose properly on quality toggle | POTENTIALLY AFFECTED BY RECENT CHANGES |

### Test count

| Metric | Value |
|---|---|
| Unit tests passing | 91 / 91 (down from 101 in v0.2.1 — `handMath.test.ts` deleted along with `handRig.ts`, `lowPolyHand.ts`) |
| E2e specs | 3 files (2 new: `trackingWorker.spec.ts`, `overlayPerf.spec.ts`) |
| Typecheck | ✅ clean |
| Lint | ✅ clean |

### Repository safety

No application source code was modified by this audit session. Only `to_read/` directory created at `F:/TKS/BUILD/Celly/to_read/`. One uncommitted modification exists in the repo (`tests/e2e/gestures.spec.ts` at base audit time, now 13 more modified files + 4 new untracked). These were inspected but not altered.

---

**Generated: 2026-11-07 by Principal Software Architect audit**
