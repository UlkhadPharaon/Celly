# RAW_CODING_AGENT_PROMPT.md — Master Implementation Prompt

---

You are a **Senior Software Engineer & Implementation Lead** dispatched to improve Celly v0.2 at `F:/TKS/BUILD/Celly` based on a comprehensive engineering audit. Execute the documented improvement plan with precision.

## READ FIRST (in order)

1. `to_read/00_START_HERE.md` — overview and status
2. `to_read/08_IMPROVEMENT_ROADMAP.md` — prioritized phases (P0→P3)
3. `to_read/04_BUGS_AND_ISSUES.md` — all confirmed bugs with IDs
4. `to_read/09_IMPLEMENTATION_SPECIFICATIONS.md` — technical specs
5. `to_read/10_TESTING_AND_VALIDATION_PLAN.md` — testing strategy
6. `to_read/11_AGENT_EXECUTION_GUIDE.md` — execution rules
7. `to_read/02_ARCHITECTURE_AUDIT.md` — architecture context
8. `to_read/03_EGM_AUDIT_REPORT.md` — adversarial review findings
9. `to_read/05_UX_AND_PRODUCT_AUDIT.md` — UX problems
10. `to_read/06_SECURITY_AND_PERFORMANCE.md` — security/performance
11. `to_read/07_REQUIREMENTS_AND_MISUNDERSTANDINGS.md` — requirement gaps
12. `to_read/12_FINAL_AUDIT_SUMMARY.md` — executive summary

## VERIFY BEFORE CODING

```bash
cd F:/TKS/BUILD/Celly
git log --oneline -5        # HEAD should be 4a17a1d
git status --short          # Note: 13 modified + 4 new untracked files
npm run typecheck && npm run lint && npm test  # Baseline: clean, 91/91 pass
```

If any check fails, report before proceeding. Do not modify source code until you've read the complete documentation package.

## SAFETY RULES

- **Never** force-push, rewrite history, or delete branches
- Create new branch per phase (`audit-p1-stability`, etc.)
- Commit after each verified phase
- Preserve uncommitted WIP; note how it affects your implementation decisions
- If an audit finding doesn't match actual code: re-read, verify line numbers, document discrepancy, adjust approach
- Never claim fix is done without running `npm test` after it

## EXECUTE PHASES IN ORDER

### Phase 1: Stability & Safety (P0 + P1)
1. Install error boundaries (`main.ts` try/catch + `window.onerror` + recovery overlay)
2. Add localStorage schema versioning (`_version` field, sanitize unknown keys)
3. Verify/fix camera retry deadlock in onboarding flow
4. Run `npm audit --audit-level=critical` and document results
5. Add FR translation completeness test

**Gate:** All existing tests pass + new tests added for this phase. Build succeeds.

### Phase 2: Interaction Polish (P1 + P2)
1. Validate selection accuracy at DPR 2.0 (run selection test under Playwright)
2. Add visual feedback pulse for instant pinch-start selection
3. Knowledge graph label collision avoidance
4. Quality toggle EffectComposer resource cleanup
5. Keyboard shortcut discoverability in help UI
6. Questionnaire progress indicator ("Q X of N")

**Gate:** Same gate as above + visual verification of UI changes.

### Phase 3: Accessibility & Mobile (P2)
1. Complete reduce-motion enforcement across all subsystems
2. Camera disabled state UI indicator during normal app use
3. Leitner flashcard reset option in control panel

### Phase 4: Documentation & Code Quality (P2 + P3)
1. Update DECISIONS.md: mark D-12 superseded, document worker rationale, record GLB→skeleton change rationale
2. Document selection semantics change rationale (pinch-start vs release)
3. Extract FrameProcessor class from CellyApp
4. Standardize textContent over innerHTML
5. Add npm audit to pre-commit verification

### Phase 5: Performance Hardening (P3)
1. Recreate camera constraints on profile/device change
2. Validate One-Euro filter stability with variable dt from async worker
3. HTTP insecure-context warning at startup

## FINAL REPORT

Output this exact format:

```
## Implementation Complete — Celly Audit

### Summary
- Phases completed: X/5
- Tasks completed: Y/Z total
- New tests added: N | Tests passing: M/M

### Files Modified
(List every file with brief description)

### Remaining Issues
(List unresolvable items with blockers)

### Verification Results
- typecheck: PASS/FAIL
- lint: PASS/FAIL
- unit tests: X/X passing
- build: PASS/FAIL

### Recommendations for v0.3
(Specific next steps)
```

---

**Good luck. Execute precisely. Report honestly.**
