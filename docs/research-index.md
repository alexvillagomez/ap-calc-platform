# Research & Notes Index

Loose files in the project root that contain research, decisions, and reference material.
All files live at `/Users/alexvillagomez/Desktop/ap-calc-platform/<filename>`.

---

## Algorithm & Learning Science

| File | Summary | Status |
|------|---------|--------|
| `research.txt` | Adaptive learning research: spaced repetition schedules, SM-2 vs FSRS, interleaving vs blocked practice, mastery thresholds, and per-difficulty progression tables. Includes explicit "next steps" tied to `practiceAlgorithm.ts` and `learn_student_keyword_states`. | **Active** — see also `knowledge-inference-research.txt` |
| `knowledge-inference-research.txt` | KST, BKT, IRT/MIRT, and co-occurrence graph approaches with engineering sketches for `practice/next/route.ts`. Proposes a 3-layer implementation stack ordered by data requirements. | **Active** — see also `future-features-needs-data.txt` |
| `future-features-needs-data.txt` | Three deferred features (co-occurrence graph, MIRT calibration, per-student spaced-repetition tuning) with SQL sketches and student-count thresholds (~50, ~500, ~100 sessions) before they become worth implementing. | **Active** — gating companion to `knowledge-inference-research.txt` |

---

## Authoring & Content Format

| File | Summary | Status |
|------|---------|--------|
| `problem-format.txt` | Canonical MCQ and FRQ JSON templates, LaTeX formatting rules (inline vs display), all field definitions including the four keyword-description fields, and math pattern examples. Reference for anyone writing or generating problems. | **Active — authoritative format spec** |
| `keyword-generation-instructions.txt` | Brief for generating the ~1000-keyword precalc catalog: two-level structure (umbrella → topic), JSON output format, granularity rules, and target counts for all 20 categories. Progress note: categories 1–7 were done at time of writing. | **Active** — see also `keyword.txt` |
| `keyword.txt` | SQL `INSERT` statements for the 10 action keywords and 8 representation keywords loaded into `learn_keywords`. Ready-to-run seed data, not a planning doc. | **Reference** (already applied to DB) |

---

## Session Logs & Verification

| File | Summary | Status |
|------|---------|--------|
| `CODEX.md` | Work log from 2026-05-28 session: keyword-strength sanitization, first-answer benchmarking, admin home-page restore, build verification, and known remaining issues (admin build failures, `topic_weights` migration). | **Reference** |
| `walkthrough.txt` | Full student-app walkthrough report (2026-05-28): auth flow, free practice, diagnostic, lessons, lookup, and progress page. Documents three code fixes applied in-session and seven open issues graded H/M/L including the keyword-weights data-quality root cause. | **Reference** |
| `demo-diagnostic-verification-report.txt` | Verification report for the Polynomials-only diagnostic restriction (2026-06-08): confirms filtering, ratings key-prop fix, "I don't know" button wiring. Documents four open issues including the `/progress` unlock gate mismatch and the 40-question cap gap. | **Reference** — see also `docs/student.md` |

---

## MCAT

| File | Summary | Status |
|------|---------|--------|
| `mcat-keywords.txt` | Complete MCAT Biology taxonomy (10 categories, 106 umbrellas, + amino-acids in-depth set) as two concatenated JSON objects. **The seed source for the live `/mcat` feature** (`npm run seed:mcat`). | **Active** — see [mcat-system.md](mcat-system.md) |

---

## Tangentially Related / Stale

| File | Summary | Status |
|------|---------|--------|
| `list.txt` | Partial list of precalc `in_depth_keywords` by category (exponents, functions, polynomials, trig, etc.) with a note about a LaTeX rendering issue and a request to improve distractor generation. Mixed planning/scratch content. | **Stale** — superseded by the full keyword catalog |
