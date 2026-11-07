# 08_IMPROVEMENT_ROADMAP.md — Improvement Roadmap

## Priority Overview

| Priority | Count | Description |
|---|---|---|
| **P0** — Critical | 1 | App crash with no recovery path |
| **P1** — High | 3 | Major functional problems, data integrity, interaction safety |
| **P2** — Medium | 5 | UX improvements, accessibility, maintainability |
| **P3** — Low | 4 | Documentation, polish items, minor optimizations |

---

## Phase 1: Stability & Safety (P0 + P1) — MUST do first

| # | Task | Description |
|---|---|---|
| 1.1 | Install error boundaries | `window.onerror` + `unhandledrejection` handlers; recovery overlay with retry/reload |
| 1.2 | Add localStorage schema versioning | `_version` field on settings; sanitize unknown keys on load; discard future-version keys |
| 1.3 | Verify/fix camera retry deadlock | Test that onboarding "retry" actually resets state and calls startCamera again |
| 1.4 | Run dependency audit | `npm audit --audit-level=critical`; document or fix any CVEs |
| 1.5 | Verify FR translation completeness | Data integrity test asserting every Loc entry has non-empty `.fr` |

---

## Phase 2: Interaction Polish (P1 + P2)

| # | Task | Description |
|---|---|---|
| 2.1 | Validate selection accuracy post-pinch-start | Run selection test at DPR 1, 1.5, 2.0; verify hit rate ≥90% |
| 2.2 | Add visual feedback for instant selection | Brief outline/glow pulse on target as soon as pinch activates (feedback during now-instant commit) |
| 2.3 | Knowledge graph label collision avoidance | Push-out algorithm for overlapping labels; abbreviate at high density |
| 2.4 | Quality toggle resource cleanup | Dispose EffectComposer passes before recreating on quality switch |
| 2.5 | Fix keyboard shortcut discoverability | Add keybinding reference to help modal |
| 2.6 | Questionnaire progress indicator | "Question X of N" header element in quiz mode |

---

## Phase 3: Accessibility & Mobile (P2)

| # | Task | Description |
|---|---|---|
| 3.1 | Complete reduce-motion enforcement | Apply consistently across auto-rotation, dust drift, edge pulses, camera tweens |
| 3.2 | Camera disabled state UI | Toast/icon when showWebcam toggled off during normal app use |
| 3.3 | Leitner progress reset option | Clear button in control panel with confirmation dialog |

---

## Phase 4: Documentation & Code Quality (P2 + P3)

| # | Task | Description |
|---|---|---|
| 4.1 | Update DECISIONS.md for D-12 supersession | Document worker rationale; record why GLB rig was replaced |
| 4.2 | Document selection semantics change | WHY "pinch-start" vs "release"; capture rationale and any device testing data |
| 4.3 | Extract FrameProcessor class | Move buildFrames(), updateHover(), stepGestures() into dedicated class |
| 4.4 | Standardize DOM text injection | Replace remaining innerHTML with textContent + escapeHtml wrapper |
| 4.5 | Add npm audit to pre-commit verification | CI or git hook checking `npm audit --audit-level=critical` |

---

## Phase 5: Performance Hardening (P3)

| # | Task | Description |
|---|---|---|
| 5.1 | Recreate camera constraints on profile change | Reopen stream on tablet rotation / external display change |
| 5.2 | Filter parameter validation | Ensure One-Euro filters handle variable dt from async worker arrival without overshoot |
| 5.3 | HTTP warning at startup | Check protocol → toast if insecure context detected |

---

## Estimated Effort

| Phase | Complexity | Est. Time |
|---|---|---|
| Phase 1 | Low-Medium | ~2.5 hours |
| Phase 2 | Medium | ~3 hours |
| Phase 3 | Low | ~1 hour |
| Phase 4 | Medium | ~2.5 hours |
| Phase 5 | Low | ~1 hour |
| **Total** | | **~10 hours** |
