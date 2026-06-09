# Difficulty Scales

Read when touching difficulty values on `problems`/`rag_examples`. Three representations exist — **never compare them directly.**

- **`difficulty`** — raw author-assigned integer, **1–5**.
- **`estimated_difficulty`** — calibrated value nudged toward observed performance, range **[0, 1]**. Updated in `apps/student/app/api/record-attempt/route.ts` (practice) and `apps/student/app/api/demo/attempt/route.ts` (diagnostic). IRT-EMA nudge is ±0.05 (tight): `newEstimated = seed + 0.15 * (target - seed)` with `target = studentSkill ∓ 0.05`. Mirrored to `rag_examples.estimated_difficulty` so demo-only problems still converge.
- **`targetDifficulty`** — computed per-student by `computeTargetDifficulty()` (`apps/student/lib/practiceAlgorithm.ts`), always in **[0.2, 0.8]** (`0.2 + avgStrength * 0.6`).

Because `estimated_difficulty`/`targetDifficulty` are on a [0,1]/[0.2,0.8] scale and `difficulty` is a raw 1–5 integer, any raw `difficulty` used as a stand-in for a calibrated value must first pass through `normalizeDifficulty()`:

```
normalizeDifficulty(d) = 0.2 + ((d - 1) / 4) * 0.6   // 1→0.2, 3→0.5, 5→0.8
```

5/5 maps to ~0.8 (not 1.0) and 1/5 to ~0.2 (not 0.0), leaving headroom on both ends so calibration can drift beyond the author rating. `scoreProblem`, `scoreProblemByKeyword`, and the `record-attempt` calibration seed all route raw `difficulty` through this helper before comparing against `targetDifficulty` or blending into `estimated_difficulty`.

**Exception:** `apps/student/app/api/learn/practice/next/route.ts` (keyword-mastery "learn" subsystem) intentionally stays on the raw 1–5 scale — it filters `rag_examples` by the raw `difficulty` column and never compares it to a calibrated/target value, so it's outside this normalized scale.
