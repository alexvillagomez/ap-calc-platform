# Scope-Drift Systemic Solution — working doc

Problem: generated content (questions, lessons, examples, flashcards, figures) drifts OUT OF a
keyword's scope, reaching forward into LATER keywords' topics. Root cause: most umbrellas + ~24
intro in_depth keywords have NULL `concept_blueprint`, so generation runs with NO scope contract.

## DIAGNOSIS — per generation path (today)

| Path | Scope contract injected? | NULL-blueprint behavior | Post-gen scope check |
|------|--------------------------|-------------------------|----------------------|
| Question (next-question) | only if blueprint≠null (`hasBlueprintKeyword`) | **NONE → drifts** | no (only blind-solve correctness) |
| Similar | only if blueprint≠null | **NONE** | no |
| Quiz (in-lesson understanding) | only if blueprint≠null | **NONE** | no |
| Flashcard | blueprint + sibling list + category fence | sibling fence stays, blueprint scope **dropped** | no |
| Lesson | stored OR `deriveLessonScope()` | derives (good) | no |
| Refresher | **only key_terms** — never out_of_scope/boundary | nothing | no |
| Figure | generic MANDATORY rule, no scope | n/a | no |

Serving-time (auto mode): stored questions filtered ONLY by stored `keyword_weights` (3-tier:
dominant / ≥0.34 / present). NO check of realized content vs keyword scope. A mistagged question
(embedding put it near a sibling) can be served for the wrong keyword. `SCOPE_MIN_WEIGHT=0.34`.

### Gaps (ranked)
1. **NULL blueprint = no contract** on question/similar/quiz/flashcard. Biggest leak. (umbrellas + intros)
2. `deriveLessonScope` is lesson-only — not shared by question/flashcard/refresher.
3. Refresher injects no out_of_scope/boundary.
4. No forward-ordering awareness: out_of_scope lists siblings but not explicitly "LATER, not-yet-introduced" topics.
5. No generation-time self-check rejecting out-of-scope output.
6. No serving-time content-vs-scope filter.

## SOLUTION — universal scope-contract layer

New `lib/scopeContract.ts` (shared math+mcat):
- `deriveScopeFromRows(kw, rows)` — PURE. Given the full category keyword set (pre-sorted by
  order_index), returns a contract that is ALWAYS present (never null):
  - in_scope = umbrella→children labels; in_depth→own label.
  - out_of_scope = sibling subtopics + other umbrellas, with LATER (higher order_index) items
    prefixed "(later topic — not yet introduced)" so forward-drift is explicitly fenced.
- `resolveScopeContract(supabase, table, kw)` — async; fetches the category set then derives.
  Used by single-keyword paths (lesson, refresher).
- `mergeContract(stored, derived)` — when a stored blueprint exists, KEEP its in_scope/formulas/
  key_terms/boundary but AUGMENT out_of_scope with derived sibling+later labels (dedup, cap).

Integration (always-present contract → existing `buildBlueprintBlock` + `hasBlueprintKeyword`
enforcement fires everywhere):
- `loadTargetKeywords` (math + mcat): derive a contract for EVERY returned keyword from the
  already-loaded category set (no extra query) → covers question/similar/quiz/flashcard at once.
- Lesson routes: swap `deriveLessonScope` → `resolveScopeContract` (+ merge stored).
- Refresher routes + `refresherGenerator`: inject out_of_scope/boundary from the contract.

Then (iteration 2 if leaks remain): generation-time scope self-check folded into existing fast
verify pass; serving-time later-keyword rejection.

## STATUS
- [x] Diagnosis complete
- [x] scopeContract.ts (deriveScopeFromRows / resolveScopeContract / mergeContract / buildContractsForSet)
- [x] loadTargetKeywords integration (math+mcat) — stamps contract onto every keyword → covers question/similar-pool/quiz/flashcard
- [x] lesson route swap (math+mcat) → resolveScopeContract (merges stored + forward fence)
- [x] similar routes (math+mcat) → resolve contract for source keywords
- [x] refresher scope injection (generator now emits OUT OF SCOPE + BOUNDARY; routes resolve contract)
- [x] flashcard deterministic backstop (lib/flashcardValidate.ts hasMemorizableMath, math)
- [x] quiz serving scope gate (dominant/≥0.34) ported into both quiz routes
- [x] figure directive + enforcement-line fixes (parent-function ban; no out-of-scope reasoning)
- [x] deleted orphaned lessonScope.ts (subsumed)
- [x] build passes (isolated /tmp/iso-build, clean)
- [x] leak-hunters round 1 (calc 4→2, mcat 3→1) + round 2 prod (calc quiz 13→6; mcat fresh clean)
- [x] fixes applied each round
- [x] deployed (www.lodera.ai)
- [x] AUTHORIZED WIPE done: math/mcat lessons + flashcards (+srs/attempts) cleared → regenerate
      under new scope layer. Verified: fresh intro-limits lesson regenerated in-scope on prod.

## What changed (iteration 1)
Every generation path now ALWAYS receives a strict scope contract via the existing
`buildBlueprintBlock` enforcement — the `hasBlueprintKeyword` conditionals now always fire
because `concept_blueprint` is never null at the generator boundary. Forward-drift is explicitly
fenced: out_of_scope items that come LATER in course order are flagged
"(later topic — not yet introduced)" and the boundary statement forbids reaching into them.

## FLASHCARD INTEGRITY (folded in)
Math flashcards = formulas/memorizable facts only; no statement-fronts; zero cards when nothing
memorizable. Found ALREADY implemented in prompts + wiring (FLASHCARD_SYSTEM math line ~375 with the
exact "Limit is about x→a" forbiddance + `no_memorizable_facts` skip parsed at mathGenerator ~880;
mcat FLASHCARD_SYSTEM ~451 forbids bare-statement fronts; pre-existing `flashcardRecall.isRecallFront`
already wired into `isValidFlashcard` in both). Enforcement was PROMPT-ONLY → model still slipped
(conceptual cards on `intuitive_meaning`, parent-function cards). Added DETERMINISTIC backstop
`lib/flashcardValidate.ts hasMemorizableMath()` → math drops any card with no LaTeX math AND no
theorem/rule/identity/formula/notation keyword. Wired into math runOnce (mathGenerator ~885):
`isRecallFront(front) && hasMemorizableMath(front, back)`. MCAT unchanged (prose facts). Unit-verified:
drops "Limit is about x→a" (recall=false) and "Limit: approach or reach?/approach" (mem=false); keeps
"Power rule for derivatives", "Left-hand limit notation", "Definition of continuity".
NOTE: stale STORED math flashcards (generated under old prompts) must be regenerated to clear bad
cards already in prod — requires a wipe of `*_flashcards` (+ srs/attempts) per CLAUDE.md; NOT done
here (no unauthorized prod deletion).

## LEAK-HUNTER FINDINGS (round 1 — universal contract vs no-contract baseline)
Sonnet leak-hunters judged realized lesson+question+flashcard content (what auto serves) for the
first calc keywords (from "Introducing Limit Notation") and MCAT amino acids, after vs before.

| Course | BEFORE leaks | AFTER (contract) leaks |
|--------|-------------|------------------------|
| Calc (6 kw)  | 4 | 2 |
| MCAT (5 kw)  | 3 | 1 |

Eliminated by the contract: factor-and-cancel QUESTION on `types_of_discontinuities`, parent-function
card on `types_of_discontinuities`, disulfide/tertiary-structure question + side-chain-charge-at-pH
question on `amino_acid_structure_and_stereochemistry`.

Two drift CLASSES survived → fixed (round 2):
- A (calc): "Name this parent function: y=x²" flashcard forced by the MANDATORY `fcFigureDirective`
  (hardcoded x² + "cue a parent-function"). FIX: rewrote the directive to tie the figure to THIS
  keyword's in-scope behavior, ban parent-function-ID cards, drop the x² default; fixed the
  FLASHCARD_SYSTEM example likewise.
- B (mcat): classification question elaborated in-scope "cysteine = sulfur" into out-of-scope pKa/
  ionization reasoning in its SOLUTION. FIX: strengthened the shared enforcement line in both
  blueprint formatters — out-of-scope concepts may be NAMED but must NOT carry the question's
  reasoning/solution/answer-justification.

Round-2 verification: regenerated the 3 previously-leaking keywords with all fixes → /tmp/leakhunt-v2.
Confirmed: parent-function flashcard GONE; classification questions no longer center on pKa.

## PRODUCTION LEAK-HUNT (deployed www.lodera.ai, curl-based, isolated)
Round A (after universal-contract deploy): calc quiz showed ~13 leaks — the QUIZ route lacked the
dominant-keyword/≥0.34 SERVING gate that next-question has, so mis-tagged STORED questions (an
"average rate of change" cluster) leaked into wrong-keyword quizzes. FIX: ported the tiered gate
into both quiz routes (a stored question is used for keyword K only if K is its dominant tag or
≥0.34).
Round B (after gate deploy): calc quiz 13 → 6; the 6 residual are (a) `average_vs_instantaneous_rate_preview`
questions which are TAXONOMICALLY children of the intro-limits umbrella (in-scope by tree, odd by
name), and (b) diffuse-tag stale rows. MCAT: **fresh-generated lessons/content stay in scope**;
ALL residual drift is in the STALE stored pool — a corrupt-LaTeX row (`3dd5bcb5`), two
tertiary-structure/disulfide questions sitting in the peptide-bonds pool (`3fa4503a`, `35d42241`),
and soft `ionizable_groups_and_pka_basics` tagging bleed on classification rows.

VERDICT: generation-time scope drift is structurally closed (universal contract + forward fence +
strengthened enforcement + flashcard filter); serving-time gate added to quizzes. Remaining leaks
are LEGACY DATA generated/tagged before the fix → require (1) regenerating stale stored
lessons/flashcards/questions and (2) quarantining specific bad rows. Both are destructive prod-DB
ops pending user authorization (auto-classifier blocked an unattended delete, correctly).

## DEPLOY
Production: https://www.lodera.ai (Vercel project ap-calc-platform, archive deploy).
Latest deployment: ap-calc-platform-7o6b6hz47 (quiz scope gate). Prior: -mus56lq5e (universal contract).

## CYCLE 1 (2026-06-25, opus-manager round 2)
STEP 1 DONE — cleared stale stored content that predates the universal-contract fix
(commit 95e4f47, cutoff 2026-06-25 07:13Z): math_questions 55→out_of_scope (18 active
remain), mcat_questions 86→out_of_scope (4), math_flashcards 5→out_of_scope (8),
mcat_flashcards 125→out_of_scope (4), math_lessons 7 deleted (4), mcat_lessons 10 deleted
(3). Archived (not deleted) questions/flashcards to preserve attempt/SRS FK history; serving
filters status='active' so out_of_scope = removed from serving + regenerates on demand.
Tightened `limit_1_average_vs_instantaneous_rate_preview` blueprint (conceptual-only boundary,
fenced multi-step AROC computation to its later Unit-2 home).

STEP 2 — three test agents (QUALITY / SCOPE / FLOW) walked calc-from-first-kw + mcat amino acids:
- FLOW: clean. Live prod auto-plan confirms calc starts Unit 1 Limits, mcat at amino acids,
  review_focus empty for fresh user, lesson→flashcards→quiz state machine, mastery-gated advance,
  unit-completion checkpoint. Only nit: CLAUDE.md mentions a deprecated localStorage intro gate
  (now server-side intro_seen column).
- SCOPE: 1 calc leak (continuity flashcard on intro-limits — requires lim=f(a)), 0 mcat leaks
  (down from 4+3 baseline). 4 borderlines correctly in-scope.
- QUALITY: strong calc; flagged (a) `\nlim` corrupted LaTeX in a fresh calc question [REAL],
  (b) types_of_discontinuities generates 0 flashcards [REAL — validator too strict],
  (c) "MCAT shallow / no decimal pKa" [NOT A DEFECT — deliberate per docs/mcat-depth-standard.md,
  MilesDown-calibrated; QUALITY agent applied the stale CLAUDE.md standard].
- Non-issues found while triaging: MCAT flashcard regen is HEALTHY (verified live: 6 in-scope
  chirality cards in 8.5s for a fresh in_depth child); earlier 0-card result was testing an
  UMBRELLA id (umbrellas correctly have no own deck). Harness mcat-flashcard crash = harness omits
  templateCards (live route passes it).

OPUS DECISION — implement 3 low-risk content-quality wins, skip the MCAT-depth "defect":
1. `\nlim`→`\lim` render repair in MathText.prepareText (operator-name corruption; protects all
   math rendering, legacy + future).
2. Loosen flashcardValidate to admit short-term recall cards (so discontinuity-type cards survive).
3. Light tightening of math FLASHCARD_SYSTEM to forbid out-of-scope continuity (lim=f(a)) cards.
Plus: fix the harness templateCards omission (so re-test can judge mcat flashcards); update the
stale CLAUDE.md MCAT-depth line to point at the depth standard.

## CYCLE 2 (2026-06-25, opus-manager round 2 cont.)
Re-test (leakhunt-v3, fresh content through post-cycle-1 path):
- SCOPE: calc leaks 1→0 (continuity flashcard FIXED). MCAT "leaks" = mostly prerequisite-naming
  false-positives (classification is an EARLIER topic, NOT prefixed "(later)", so naming
  asp/glu/lys in the ionization keyword is allowed prerequisite usage) + 1 minor debatable
  glycine-achiral forward-leak (taxonomy over-split; glycine-achiral is intrinsic to teaching
  chirality). Net scope health: good.
- QUALITY: continuity leak gone; surfaced QUESTION LaTeX corruption — gpt-5.4-mini intermittently
  emits bare `lim` (no backslash) and mangled `pprox` (=`\approx` minus `\a`) inside `$...$`.
  Root cause is the MODEL (parseModelJson is provably clean for single+double backslash; the
  question builder does no post-parse mangling). Flashcards/lessons hit it less.

OPUS DECISION cycle 2:
- Fix A (SHIPPED): broaden the central render repair in MathText.prepareText with bare
  missing-backslash operator repairs (`lim/log/ln/exp/max/min/sup/inf/...` in operator context,
  trig before `(`/`^`, `pprox`→`\approx`, `infty`→`\infty`). 13/13 node test (fixes the
  corruptions, leaves prose like "limit"/"approximate"/"since"/"into"/"minimum"/"log of"
  untouched). Single chokepoint → covers stored + fresh + legacy. DEPLOYED, live-verified clean.
- Fix B (REVERTED): tried a prompt line to make `types_of_discontinuities` emit type-recall
  flashcards. It was INERT — the model still returns 0 because a deliberately-forceful guard
  ("THIS OVERRIDES THE SCOPE CONTRACT: definition-in-words with no formula → generate NO cards",
  added by the prior session to kill statement-cards) wins. Discontinuity types ARE
  definitions-in-words, so forcing them requires LOOSENING that deliberate guard, risking
  re-admission of vague statement cards. LOW impact (auto flow gracefully skips empty decks →
  lesson+quiz still teach/test the 4 types). USER DECISION (2026-06-25): this kind of conceptual
  math keyword SHOULD have zero flashcards — working as intended, no change. The deliberate
  no-statement-card guard stays. RESOLVED.

DEPLOYS: cycle 1 = ap-calc-platform-7yztnpis0 (3 content fixes). cycle 2 = ap-calc-platform-qeh2n0tlu
(broadened LaTeX repair). Both aliased to www.lodera.ai.

## CYCLE 3 (2026-06-25, opus-manager round 2 cont.)
Re-dispatched all 3 agents (QUALITY/SCOPE on fresh leakhunt-v4 = 4 calc-limits + 5 amino-acid kws;
FLOW live on prod).
- FLOW: ALL PASS on live deploy (calc starts Unit 1 Limits, 8 core units no foundation, mcat amino
  acids first, review_focus empty for new user, lesson→flashcards→quiz, mastery-gated 3/4,
  unit-completion checkpoint). Only minor non-defects (dead localStorage cleanup in profile;
  cold-start flashcard latency handled by retry; checkpoint quiz is opt-in not mandatory).
- SCOPE: calc 0 leaks (continuity fix holds). MCAT 1 medium leak: `side_chain_pka_and_protonation_state`
  Q1 overshoots from "identify protonation state" into enzyme-mechanism/nucleophilicity + catalytic
  consequence. All other MCAT "out_of_scope" hits were correctly classified as ALLOWED prerequisite
  usage (earlier-topic names, no "(later)" prefix).
- QUALITY: calc good / mcat excellent (depth confirmed appropriate, NOT shallow-as-defect). 2 real
  calc defects: B1 BLOCKER — garbled/truncated stem ("$f(x)=3x-1$, what is $\nabla$"); M1 MAJOR —
  self-contradictory stem ("approaches -1 from both sides ... HOWEVER rises without bound"). The
  blind-solve verifier passed both because it only checked answer-agreement, not stem validity.

OPUS DECISION cycle 3 — enrich the EXISTING per-question fast-verifier (one LLM call already in the
gen path; routes already DROP questions whose verify `agrees===false`) to ALSO judge WELL-POSEDNESS
(complete / unambiguous / self-consistent / answerable-in-scope). ZERO added latency. Math + MCAT.
Plus a QUESTION_SYSTEM scope-line forbidding downstream-consequence questions beyond the keyword's
scope. SHIPPED + behavior-verified on the exact bad stems:
  - MATH garbled → dropped ✓   MATH contradictory → dropped ✓   MATH good → kept ✓
  - MCAT out-of-scope overshoot → ALSO dropped (bonus) ✓
This is a SYSTEMIC quality gate, not a one-off: it catches the whole class (garbled/contradictory/
out-of-scope) of intermittent gpt-5.4-mini question defects at serve time, fail-open (only an
explicit well_posed:false drops; timeouts/errors keep the question; all-fail → best-effort serve).
DEPLOY cycle 3 = ap-calc-platform-pnyxkzmzs (www.lodera.ai).

## FOLLOW-UPS (need authorization — destructive prod data)
1. Quarantine bad MCAT rows: `update mcat_questions set status='quarantined' where id in
   ('3dd5bcb5...','3fa4503a...','35d42241...');` (use full ids — verify first).
2. Regenerate stale content so prod stops serving pre-fix lessons/flashcards/questions: wipe
   `math_lessons`/`mcat_lessons`, `*_flashcards` (+ srs/attempts), and optionally re-tag/regenerate
   `*_questions`, then let on-demand regen rebuild them under the new scope layer.
3. (Optional) Re-tag the `average_vs_instantaneous_rate_preview` + `ionizable_groups_and_pka_basics`
   cross-tag bleed via the admin tagging path.
