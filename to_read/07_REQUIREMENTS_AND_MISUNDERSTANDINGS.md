# 07_REQUIREMENTS_AND_MISUNDERSTANDINGS.md — Requirements & Misunderstandings

## Product vs Implementation Gaps

### R-01: DECISIONS.md D-12 contradicts current implementation

**Claim:** D-12 states *"Tracking on the main thread, not a worker"* with rationale about ~4-8ms synchronous inference at 720p.

**Actual:** Inference runs in `trackingWorker.ts` via Web Worker with ImageBitmap transfer. Main thread only captures frames and consumes results.

**Risk:** Future developers reading D-12 will make wrong architectural decisions (e.g., trying to optimize main-thread inference path). The documented constraint is false.

**Decision needed:** Update DECISIONS.md to reflect actual architecture. Mark D-12 as superseded by new entry.

---

### R-02: Selection semantics changed without product decision documentation

**Claim:** Old behavior committed on release after hold + travel validation. New behavior commits on pinch-start.

**Gap:** This changes the fundamental interaction model — selections now happen instantly when fingers close, without user confirmation. No CHANGELOG or DESIGN doc explains why this trade-off was made ("like Cellab" per code comment).

**Impact:** Users expecting deliberate commit-on-release may accidentally select organelles while aiming. Or it may feel more responsive and intuitive — empirical testing needed.

**Decision needed:** Document the rationale for switching selection semantics. Record whether Cellab-style instant-selection was the intended behavior all along, or an adaptation based on device testing.

---

### R-03: Content localization completeness unclear

**Claim:** Bilingual EN/FR, every string `{ en, fr }`.

**Actual:** Types define `fr?: string` (optional). Without running a counting script over JSON files, I cannot verify ALL 36 knowledge nodes, 48 MCQs, and 36 flashcards have FR equivalents. The existing data integrity test checks count minimums but NOT French field presence.

**Risk:** Missing French translations degrade silently (falls back to English). For a bilingual product, this is a quality concern.

**Decision needed:** Add data integrity assertion verifying every `Loc` entry has non-empty `.fr` field. Run `node scripts/shots.mjs` with FR locale to catch rendering issues.

---

### R-04: Flashcard display convention unverified

**Claim:** DECISIONS.md D-44 states flashcard back restates the question above the answer.

**Actual:** `questions.json` has separate `front` and `back` fields per flashcard. Rendering displays `back.fr ?? back.en` as-is. Whether the front question is embedded in the back content depends on how authors wrote the JSON entries.

**Decision needed:** Verify JSON entries match the implementation assumption. If not, fix the data or the rendering.

---

### R-05: Keyboard shortcut discoverability gap

Keyboard shortcuts work (1/2/3 page navigation, R auto-rotate, L language, M mirrorX, D debug overlay, T selection test, H help, Escape close overlay) but are NOT documented anywhere users encounter them. Help modal (`showHelp()`) opens onboarding which describes gestures but not keyboard bindings.

**Decision needed:** Add keybinding reference panel accessible from help modal or control panel.

---

## Unresolved Product Decisions

| ID | Question | Context | Owner |
|---|---|---|---|
| DP-01 | Selection semantics: instant-commit vs deliberate-commit? | Trade-off between responsiveness and precision | Ulkhad Pharaon |
| DP-02 | Audio feedback policy? | DELIBERATELY blocked since v0.2 (D-29 autoplay complexity) | Ulkhad Pharaon |
| DP-03 | CDN WASM fallback acceptable? | Adds external dependency not present in original design | Ulkhad Pharaon |
| DP-04 | What does "reduce motion" mean precisely? | Partial implementation; scope undefined | Ulkhad Pharaon |
