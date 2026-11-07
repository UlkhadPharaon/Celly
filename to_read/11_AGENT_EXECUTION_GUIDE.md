# 11_AGENT_EXECUTION_GUIDE.md — Agent Execution Guide

## Before you begin

1. **Read all docs in order:** `00_START_HERE` → `01_PROJECT_OVERVIEW` → `08_IMPROVEMENT_ROADMAP` → `04_BUGS_AND_ISSUES` → `09_IMPLEMENTATION_SPECIFICATIONS`
2. **Verify repository state matches this audit:**
   ```bash
   cd F:/TKS/BUILD/Celly
   git log --oneline -5    # Should show 4a17a1d as HEAD
   git status --short      # Note all uncommitted changes (13 modified + 4 new files)
   npm run typecheck && npm run lint && npm test  # Baseline: 0 errors, 91/91 passing
   ```
3. **DO NOT implement blindly.** If any finding doesn't match actual code when you inspect it, document the discrepancy and reassess.

## Execution sequence

Execute phases in order. Each phase's tests must pass before advancing.

```
Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5
(Stability)  (Polish)   (A11y)    (Refactor/docs)  (Perf)
```

## Mandatory per-phase gates

After EACH phase:
```bash
npm run typecheck    # 0 errors
npm run lint         # 0 errors
npm test             # all existing tests pass + new ones added for that phase
npm run build        # production bundle succeeds
```

If ANY gate fails, fix it before continuing. Do not proceed past a failing gate.

## Anti-hallucination protocol

- If an audit finding doesn't match actual code: re-read the file, verify line numbers, document discrepancy, adjust approach
- Never follow a spec blindly if the code has changed since the audit
- Never claim a fix is done without running `npm test` after it
- Never invent test results — only report what actually passes/fails

## Git safety rules

- Never force-push, rewrite history, or delete branches
- Create new branch per phase (`audit-p1-stability`, etc.)
- Commit after each verified phase
- Never commit `node_modules/` (.gitignore handles this)
- Preserve uncommitted work-in-progress; note which WIP changes affect your implementation decisions

## Final report format

```
## Implementation Complete — Celly Audit

### Summary
- Phases completed: X/5
- Tasks completed: Y/Z total
- New tests added: N | Tests passing: M/M

### Files Modified
(List every file with brief change description)

### Remaining Issues
(List unresolvable items with why and blockers)

### Verification Results
- typecheck: PASS/FAIL
- lint: PASS/FAIL  
- unit tests: X/X passing
- build: PASS/FAIL

### Recommendations for v0.3
(Specific next-step suggestions)
```
