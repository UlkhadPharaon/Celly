# 05_UX_AND_PRODUCT_AUDIT.md — UX & Product Audit

## Confirmed UX problems (unchanged since v0.2.1)

### UX-001: Knowledge graph label overlap at certain zoom levels

**Problem:** 36 nodes in force layout produce overlapping labels on tablets and when viewing full graph. No collision avoidance algorithm exists. Labels render above everything (`renderOrder = 1`) without checking sibling overlap.

**Location:** `src/scene/knowledgeScene.ts`

**Impact:** At tablet widths or when viewing full graph, overlapping labels make node names unreadable. Particularly bad for conceptually related nodes placed near each other.

**Recommendation:** Label push-out algorithm or abbreviated labels at high density.

**Priority: P2**

---

### UX-002: No haptic/audio feedback for key interactions

**Problem:** Pinch selection, quiz answers, flashcard swipes — purely visual confirmation. For a gesture-controlled interface where physical touch is absent (hands remote in camera space), this gap is noticeable.

**Status:** Not addressed by recent changes.

**Recommendation:** Optional Web Audio API beeps gated behind control panel toggle. Minimal synthesized tones needed (no external assets).

**Priority: P3** (documented as deliberate D-29 decision in DECISIONS.md)

---

### UX-003: Onboarding assumes camera permission will succeed

**Problem:** "Continue with mouse" is present but appears after camera enable path fails rather than as equal first choice. User who denies camera permission sees error screen instead of smooth transition to mouse mode.

**Status:** Uncommitted changes improved this significantly — onboarding now shows inline status messages per step (`cameraOff`, `cameraConnecting`, `cameraLive`, `cameraError`). But both "Enable camera" and "Continue with mouse" appear simultaneously as equal choices in the intro step (L314-L318 of `onboarding.ts`). **This is FIXED.** ✅

---

### UX-004: Quiz navigation lacks within-set progress indication

**Problem:** Questionnaire set of 10 questions — no visible indicator of current position ("Question 7/10"). Progress bar shows overall test progress only.

**Recommendation:** Simple "Q X of N" header element updating each question.

**Priority: P2**

---

### UX-005: Gesture feedback during pinch hold removed

**Problem (NEW from uncommitted changes):** Old behavior showed an armed target highlight during 100ms+ pinching hold period before release committed the selection. New "commit on pinch-start" means selection fires instantly with no visual preview. Users can't tell if their intended target was locked onto until it's already selected.

**Impact:** Without visual feedback, users have no confidence that their pinch hit the right organelle. The instant commit makes it feel like clicking the moment fingers touch — disorienting.

**Recommendation:** Add a brief visual pulse (e.g., outline glow) on the target that triggers the moment pinch activates, lasting ~150ms to give users confirmatory feedback before selection completes.

**Priority: P2**

---

### UX-006: Camera disabled state not clearly communicated

**Problem:** When camera is available but user disables it (via control panel showWebcam off), there's no clear "Camera off" status in the UI. The HUD hides entirely at ≤820px so even telemetry doesn't show "waiting."

**Status:** Uncommitted onboarding work added camera state display (`camera-state` span) on step 2 hands check, but this only appears during onboarding flow, not during normal app use.

**Recommendation:** Show "Camera off" toast or small icon when showWebcam is toggled off, persisting until re-enabled.

**Priority: P3**

---

## Positive observations from uncommitted changes

1. **Camera state visibility** — Onboarding now shows real-time camera status per step (`cameraConnecting`, `cameraLive`, `cameraError`)
2. **CDN fallback** — Worker tries local wasm first, then cdn.jsdelivr.net as fallback — improves resilience on restricted networks
3. **Skeleton hand readability** — Dark rim + colored core shader design keeps joints readable against bright cell membrane/bloom
4. **DPR-aware point sizing** — Skeleton joints use constant CSS-pixel size regardless of camera distance via `gl_PointSize = aSize * uPixelRatio`
5. **Keyboard accessibility** — Onboarding now focuses enable button on open, traps focus in dialog, restores previous focus on close
6. **Click outside modal to dismiss** — Onboarding root click handler allows dismissing via backdrop click
