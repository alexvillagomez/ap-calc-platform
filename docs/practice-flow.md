# Demo Practice Flow (Duolingo-style spaced/interleaved)

The post-diagnostic practice at `/demo-practice` (`apps/student/app/demo-practice/page.tsx`). Replaces the old "3 correct in a row to master, then next keyword" model with spaced, interleaved practice driven by the server's existing scoring/mastery/scheduling.

## Key insight
The server already does the hard part — `POST /api/learn/practice/attempt` returns `{ state, in_depth_score, consecutive_correct, total_attempts }`, applies an EMA score update, the mastery gate (`in_depth_score ≥ 0.8 AND consecutive_correct ≥ 4` → `state = 'mastered'`), and schedules the next spaced review via `computeNextReviewDate` / `REVIEW_INTERVALS = [1,3,7,14,30,60]` (in `practiceAlgorithm.ts`). The demo-practice page just **uses that response** instead of a client-side streak counter.

## Behavior
- **Curriculum order.** Queue is sorted by `UMBRELLA_ORDER.indexOf(umbrellaId)` (foundational → advanced: structure → values → addition → multiplication → GCF factoring → quadratic factoring → division → equations → zeros/graphs → tables), then `in_depth_score` ascending (weakest first). Foundational skills are taught before advanced ones, among the student's weak skills. `UMBRELLA_ORDER` is a hardcoded constant in the page (matches `insert_polynomials.sql` order; no DB column needed).
- **Block-based progression.** `BLOCK_SIZE = 3` practice problems on the current keyword, then advance to the next curriculum keyword (no streak gate). Advance early if the server marks `state === 'mastered'`. After a lesson, the block counter resets so the student gets a fresh block.
- **Interleaving / spaced review.** `INTERLEAVE_PROB = 0.30`: once ≥2 keywords have been practiced this session, each problem has a 30% chance of being a **review card** from an earlier keyword (past-due `spaced_review_due_at` preferred, else weakest by score). Review cards show a "Review" badge and don't count toward the current block.
- **Multi-pass.** The queue filter keeps a keyword if `state !== 'mastered'` OR it has a due `spaced_review_due_at`. When the queue is exhausted, it re-fetches `/api/learn/progress` and continues if anything is still `< 0.75` or due; only then shows "done".
- **No auto-advance.** Lessons (explanation steps) and practice solutions stay on screen until the student clicks "Next" — the prior 4s/3s auto-advance countdowns were removed so students can read the solution/explanation at their own pace.
- **Mastery UI.** The old 3-dot streak indicator was replaced with the keyword's `in_depth_score %` mastery bar.

## Supporting pieces
- **Position resume** — `GET/POST /api/demo-practice/position` persists `{ keywordId, phase, lessonStepIdx, problemId }` to `student_sessions.practice_*` columns so a returning student resumes exactly (see [journey-routing.md](journey-routing.md)).
- **Restart with reset** — both restart entry points open a red **"Reset everything"** warning modal, then call `POST /api/demo/reset` which clears `learn_student_keyword_states`, the `diagnostic_completed_at` flag, and the saved practice position.

## Reuse (do not reimplement)
`computeNextReviewDate`, `isReviewDue`, `getLearningPhase`, `REVIEW_INTERVALS` in `practiceAlgorithm.ts`; the phase-routing + mastery gate in `app/api/learn/practice/{next,attempt}/route.ts`. The demo-practice page should NOT re-implement scoring, mastery, or scheduling — it reads the attempt response and trusts the DB `state`.
