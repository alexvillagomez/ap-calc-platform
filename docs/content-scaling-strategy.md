# Content Scaling Strategy — From Hand-Authored Demo to All of Precalc

**Status:** Strategy / planning report
**Date:** 2026-06-09
**Scope:** How to generate problems for every precalc keyword at scale, keep the diagnostic short, and stop authoring problems by hand externally.

---

## 0. TL;DR

You already built ~80% of the machine. The demo proved the *runtime* (adaptive diagnostic, evidence propagation, IRT calibration, runtime variant generation). What you have **not** built is the **content factory** — the offline pipeline that turns a keyword definition into a batch of verified problems without you writing them by hand.

The shift in mental model:

> **Stop authoring problems. Start authoring keywords.**
> A keyword (good description + 3–5 worked examples + prerequisite edges) is the durable asset. Problems are a *cheap, regenerable output* of a keyword. Hand-authoring problems is authoring the wrong layer.

Three concrete moves, in priority order:

1. **Complete the keyword taxonomy for all 9 precalc units first** (umbrella → in-depth → prerequisite edges). This is the only part that genuinely needs human judgment.
2. **Build a generate → verify → tag → embed → load pipeline** so each keyword yields 3–5 *verified* seed templates automatically. Runtime variant generation (already built) handles practice volume from there.
3. **Separate the diagnostic pool from the practice pool.** The diagnostic does *umbrella-level triage on a prerequisite DAG* — it does not test every keyword. This is what keeps the question count low (~15–25 total for all of precalc, not per unit).

The rest of this report explains each move and gives copy-ready code for when you're ready to build.

---

## 1. Where the inefficiency actually is

You said: *"I created all the problems externally but I don't want to do that because inefficient."*

Authoring problems externally is slow for four compounding reasons:

| Cost | Why it hurts at scale |
|------|----------------------|
| **Linear human effort** | Every problem is a unit of your time. 9 units × ~10 umbrellas × ~5 in-depth × 5 problems = **~2,250 problems**. At even 5 min each that's ~190 hours of pure authoring. |
| **No reuse** | A hand-authored problem can't be re-generated, re-leveled, or re-tagged. If your schema changes (it has — four-dimensional weights are "NEW schema"), you re-touch every row. |
| **Verification is ad-hoc** | You're the only correctness check. Errors leak into `rag_examples` and surface in front of students. |
| **Bottleneck is you** | The factory can't run while you sleep. AI generation can. |

The platform already contains the expensive-to-build parts that make a factory *safe*: validation/parsing (`ragProblemParser.ts`), auto-tagging (`keywordTagger.ts`), embeddings, and a `status: pending_review` gate. You're hand-doing the one step that's most automatable (drafting) and skipping the steps that benefit most from automation (verification, tagging, leveling).

---

## 2. The asset hierarchy — author keywords, generate problems

Think of content as a stack. Effort should concentrate at the top; everything below is generated.

```
┌─────────────────────────────────────────────────────────────┐
│ TIER 0  Unit taxonomy        9 precalc units                 │  ← fixed, public (College Board)
│ TIER 1  Umbrella keywords    ~10 per unit                    │  ← HUMAN-CURATED (high value)
│ TIER 2  In-depth keywords    ~3–6 per umbrella               │  ← AI-DRAFTED, human-reviewed
│         + prerequisite edges (the DAG)                       │  ← HUMAN-CURATED (high value)
│         + description + 3–5 worked examples per keyword      │  ← AI-DRAFTED, human-reviewed
├─────────────────────────────────────────────────────────────┤
│ TIER 3  Seed problems        3–5 templates per in-depth kw   │  ← GENERATED + auto-verified
│ TIER 4  Practice variants    ∞ on demand                     │  ← GENERATED at runtime (already built)
└─────────────────────────────────────────────────────────────┘
```

**The rule:** Human time goes into Tier 1 and 2. Tier 3 is a batch job. Tier 4 already exists (`generateVariantFromTemplate`).

Why this works: your `learn_keywords` rows already carry `description` and `examples` (jsonb array). Those two fields are *exactly* the prompt context a generator needs. A well-written keyword **is** a generation spec. So the moment the taxonomy is solid, Tier 3 is a loop, not a project.

### How many seed templates per keyword?

You do **not** need hundreds of static problems per keyword, because Tier 4 (runtime variants) gives infinite practice. You need enough *templates* to capture structural variety (different problem shapes / representations / difficulty bands), not numeric variety.

Recommended: **3–5 seed templates per in-depth keyword**, spread across:
- 2–3 difficulty bands (easy / medium / hard → `difficulty` 2, 3, 4)
- 2+ representations where the keyword supports it (`equation`, `graph`, `table`, `contextual_situation`)

That's ~5 × 5 × 10 × 9 = **~2,250 templates** total — but generated and verified by a batch job overnight, not by hand. And practice volume on top of that is free via variants.

---

## 3. The content factory pipeline

A single repeatable per-unit pipeline. Run it once per unit; it's idempotent.

```
                        ┌──────────────────────────────────────┐
  learn_keywords  ───►  │ 1. PLAN                               │
  (desc + examples)     │   for each in-depth keyword, build a  │
                        │   generation matrix:                  │
                        │   {difficulty band} × {representation}│
                        └──────────────┬───────────────────────┘
                                       ▼
                        ┌──────────────────────────────────────┐
                        │ 2. GENERATE  (LLM, schema-constrained)│
                        │   reuse apps/admin generate-problem   │
                        │   prompt + JSON schema                │
                        └──────────────┬───────────────────────┘
                                       ▼
                        ┌──────────────────────────────────────┐
                        │ 3. VERIFY  (the part you're missing)  │
                        │   a) symbolic check (SymPy/CAS)       │
                        │   b) adversarial LLM solver re-solves │
                        │      blind, must match correct_index  │
                        │   reject on mismatch → regenerate     │
                        └──────────────┬───────────────────────┘
                                       ▼
                        ┌──────────────────────────────────────┐
                        │ 4. TAG  (reuse keywordTagger.ts)      │
                        │   keyword / action / representation / │
                        │   prerequisite weights + descriptions │
                        └──────────────┬───────────────────────┘
                                       ▼
                        ┌──────────────────────────────────────┐
                        │ 5. EMBED  (text-embedding-3-small)    │
                        └──────────────┬───────────────────────┘
                                       ▼
                        ┌──────────────────────────────────────┐
                        │ 6. LOAD  → rag_examples               │
                        │   status = 'pending_review'           │
                        └──────────────┬───────────────────────┘
                                       ▼
                        ┌──────────────────────────────────────┐
                        │ 7. REVIEW  (sampled, not exhaustive)  │
                        │   admin queue; approve in bulk        │
                        └──────────────────────────────────────┘
```

**Step 3 is the unlock.** It's the difference between "AI-generated problems are risky" and "AI-generated problems are safe at scale." Two independent checks:

1. **Symbolic / CAS check** — for anything computable (factoring, simplification, solving, derivatives), have SymPy evaluate the stated answer. A generator that says `12x^3 + 18x = 6x(2x^2+3)` can be verified by expanding the RHS and checking equality. This catches ~80% of math errors deterministically, for free.
2. **Adversarial blind solver** — a *second* LLM call that sees only `latex_content` + `choices` (not the claimed answer) and must pick the correct index. If it disagrees with the generator, flag/regenerate. This catches ambiguous wording, bad distractors, and "two correct answers."

Only problems that pass **both** go to `rag_examples`. This is the "generator + verifier" pattern and it's what lets you trust a batch of 2,000 problems you didn't read.

**Step 7 — review by sampling, not exhaustively.** Once verification pass-rate is measured (e.g. "97% of verified problems are clean on spot check"), you review a random 5–10% per batch and approve the rest in bulk. Reviewing all 2,250 by hand would re-create the bottleneck you're escaping.

---

## 4. Keeping the diagnostic short — the real question

This deserves its own section because it's where most platforms get it wrong: they assume "more keywords → more diagnostic questions." That's false here, because you already built **evidence propagation** and you can exploit **prerequisite structure**.

### Principle 1 — The diagnostic triages umbrellas, it does not assess keywords

The diagnostic's job is **routing**, not fine-grained measurement. It needs to decide, per umbrella: `full_lesson / refresher / targeted / skip`. That's a 4-way bucket at the *umbrella* level (~90 umbrellas across precalc), not a mastery score for each of ~450 in-depth keywords.

Fine-grained keyword assessment happens *during lessons and practice*, where you have many attempts to spend. The diagnostic should spend as few as possible.

### Principle 2 — Evidence propagation means 1 problem informs many keywords

You already propagate evidence to siblings (in-depth under the same umbrella) and prerequisites. So one well-chosen problem at the umbrella's "center of mass" updates the whole umbrella's estimate. Choose, per umbrella, **one anchor in-depth keyword** — the most representative/central skill — and one anchor problem at medium difficulty. That's your default probe.

### Principle 3 — Walk the prerequisite DAG; prune what's unreachable

This is the big lever. Build a **cross-unit prerequisite DAG** (it's mostly Tier-2 work you're doing anyway). Then run the diagnostic as adaptive testing on that DAG:

- **Start at foundational umbrellas** (exponent rules, basic algebraic manipulation).
- **Strong on a foundation → climb.** Test the things it unlocks.
- **Weak on a foundation → stop climbing that branch.** If a student can't do exponent rules, you already know they'll fail logarithms and exponential functions. Don't spend questions confirming it — route the whole downstream branch to `full_lesson` and move on.

This turns diagnostic length from **linear in #umbrellas** into **roughly logarithmic** — you only spend questions at the *frontier* between what the student knows and doesn't.

```
            exponent_rules ●  (strong)
                 │
        ┌────────┴────────┐
   polynomials ●        radicals ○  (weak → STOP)
   (strong)              │
        │            rational_exponents  ✗ skipped (unreachable until radicals fixed)
   factoring ○ (weak → frontier found, drill here)
        │
   quadratics  ✗ skipped (don't test, prereq failed)
```

In this example, 4 questions placed the student precisely on two branches and pruned ~6 downstream umbrellas. That's the mechanism that keeps total count at **~15–25 for all of precalc**.

### Principle 4 — Stop conditions you already have, applied globally

Your demo already stops early when umbrellas are "well tested" or pass a mastery gate. Generalize that to the DAG walk:

- Stop a branch when its umbrella estimate has tight enough confidence (you can use attempt count as a proxy, as the demo does, or add a simple variance/Beta-posterior confidence).
- Stop globally at a hard ceiling (e.g. 25) and route everything untested to a conservative default (`refresher`), to be refined in-lesson.

### Diagnostic pool sizing

The diagnostic needs only the **anchor problems**: ~1–2 per umbrella × ~90 umbrellas = **~90–180 problems**, tagged `is_diagnostic` (or pulled from a dedicated `learn_diagnostic_problems` set, which you already have a seeding script for). These should be your *highest-quality, human-reviewed* problems, because they drive routing. Generate them with the factory, but review them 100% — this is the one place exhaustive review is worth it. Everything else (practice) is sampled review.

> **Summary:** Short diagnostic = (triage at umbrella level) × (evidence propagation: 1 problem → many keywords) × (DAG pruning: skip unreachable branches) × (early stop). None of these require new ML — three of the four already exist; only the DAG walk is new orchestration.

---

## 5. Build order / roadmap

Sequence matters — each phase unlocks the next.

| Phase | Goal | Output | Effort |
|-------|------|--------|--------|
| **P0** | Lock the factory on Polynomials (already seeded) | Regenerate the demo's polynomial problems *through the pipeline*; compare to hand-authored. Proves quality parity. | Small — validates the approach before scaling |
| **P1** | Complete the taxonomy for all 9 units | `learn_keywords` rows: umbrella + in-depth + descriptions + examples + **prerequisite edges** | **Largest human-judgment investment.** AI-draft, you review. |
| **P2** | Run the factory per unit | ~2,250 verified templates in `rag_examples`, `pending_review` | Mostly compute; sampled review |
| **P3** | Build the cross-unit prerequisite DAG + diagnostic blueprint | A DAG file + selection of ~90–180 anchor diagnostic problems (100% reviewed) | Medium |
| **P4** | Generalize the demo diagnostic to DAG-walk all of precalc | Adaptive diagnostic across 9 units, ~15–25 questions | Medium — extends existing demo logic |
| **P5** | Turn on runtime variants everywhere | Infinite practice from templates | Already built; just wire per unit |

**Critical-path insight:** P1 (taxonomy) gates everything. Do it first and do it well. If the keyword graph is good, P2 is a weekend batch job and P4 is mostly reusing demo code. If the keyword graph is sloppy, no amount of generation fixes it — you'll generate confident, well-formatted problems for skills that don't map to how precalc actually builds on itself.

---

## 6. Quality, cost, and risk

**Quality gates (in order of strength):**
1. Schema validation (`ragProblemParser.ts`) — already exists.
2. Symbolic/CAS verification — *new, highest ROI.*
3. Adversarial blind-solver agreement — *new.*
4. Distractor distinctness + misconception coverage check.
5. Sampled human review (5–10%) for practice; 100% for diagnostic anchors.
6. Live signal — `avg_rating`, `success_count`, "flag as poor quality." Problems that students rate poorly or that have anomalous success rates auto-return to review.

**Cost envelope (rough, order-of-magnitude):** With a small model for generation + a small model for the blind solver + SymPy (free), per-problem generation is fractions of a cent. ~2,250 templates is a few dollars of inference and one overnight run — versus ~190 hours of your time. The expensive resource is your review attention; spend it on taxonomy (P1) and diagnostic anchors (P3), not on practice problems.

**Risks and mitigations:**
- *AI math errors* → dual verification (CAS + blind solver); never load unverified.
- *Garbage-in taxonomy* → P1 human review; treat prerequisite edges as the highest-value artifact.
- *Homogeneous problems* → generation matrix forces difficulty × representation spread; runtime variants add numeric diversity.
- *Schema drift* → because problems are regenerable, a schema change becomes "re-run the batch," not "re-author 2,250 rows." This is the whole point of authoring keywords not problems.
- *Diagnostic mis-routes* → anchors are 100% reviewed; routing is conservative (when unsure, `refresher` not `skip`); in-lesson assessment corrects.

---

## 7. Actionable code (for when the time is right)

These are skeletons grounded in your actual schema (`rag_examples`, `learn_keywords`, four-dimensional weights, existing `generate-problem` prompt and `keywordTagger`). They're intentionally close to drop-in but left as TODO-marked stubs so you wire them to your real clients.

### 7.1 The batch factory — `scripts/factory/generate-unit-problems.ts`

```ts
// Usage: pnpm tsx scripts/factory/generate-unit-problems.ts --unit polynomials --perKeyword 5
//
// Pipeline: plan → generate → verify → tag → embed → load (status=pending_review).
// Idempotent: skips (keyword, difficulty, representation) cells already filled.

import { createClient } from "@supabase/supabase-js";
// reuse what already exists:
import { buildGenerationPrompt, PROBLEM_SCHEMA } from "../../apps/admin/lib/ai/generateProblemPrompt"; // TODO: confirm export path
import { autoTagKeywords } from "../../apps/admin/lib/ai/keywordTagger";
import { parseAndValidateRagProblem } from "../../apps/admin/lib/ragProblemParser";
import { verifyProblem } from "./verify"; // 7.2
import { embedText } from "./embed";      // text-embedding-3-small wrapper

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

// The generation matrix: structural variety, not numeric variety.
const DIFFICULTY_BANDS = [2, 3, 4];                 // easy / medium / hard
const REPRESENTATIONS  = ["equation", "graph", "table", "contextual_situation"];

async function generateForKeyword(kw: KeywordRow, perKeyword: number) {
  // Spread `perKeyword` problems across difficulty × representation cells.
  const cells = planCells(perKeyword, DIFFICULTY_BANDS, pickRepresentations(kw, REPRESENTATIONS));

  for (const cell of cells) {
    if (await cellAlreadyFilled(kw.id, cell)) continue; // idempotent

    let problem = null;
    for (let attempt = 0; attempt < 3 && !problem; attempt++) {
      // 2. GENERATE — reuse the admin prompt; seed with the keyword's own desc + examples
      const raw = await callLLM(buildGenerationPrompt({
        keyword: kw.name,
        description: kw.description,
        examples: kw.examples,            // jsonb array already on the row
        targetDifficulty: cell.difficulty,
        representation: cell.representation,
      }), { schema: PROBLEM_SCHEMA, model: "small" });

      const candidate = parseAndValidateRagProblem(raw); // schema + sanitize (existing)
      if (!candidate) continue;

      // 3. VERIFY — the part that makes scale safe
      const verdict = await verifyProblem(candidate);
      if (!verdict.ok) { log(`reject ${kw.id} ${cell.difficulty}: ${verdict.reason}`); continue; }

      problem = candidate;
    }
    if (!problem) { log(`gave up on ${kw.id} ${JSON.stringify(cell)}`); continue; }

    // 4. TAG — four-dimensional weights (reuse existing tagger)
    const tags = await autoTagKeywords(problem.latex_content, problem.solution_latex);

    // 5. EMBED
    const embedding = await embedText(`${problem.latex_content}\n${problem.solution_latex}`);

    // 6. LOAD
    await supabase.from("rag_examples").insert({
      course: "precalc",
      latex_content: problem.latex_content,
      solution_latex: problem.solution_latex,
      choices: problem.choices,
      correct_index: problem.correct_index,
      wrong_answer_data: problem.wrong_answer_descriptions,
      difficulty: cell.difficulty,
      keyword_weights: tags.keyword_weights,
      action_weights: tags.action_weights,
      representation_weights: tags.representation_weights,
      prerequisite_weights: tags.prerequisite_weights,
      topic_description: tags.topic_description,
      action_description: tags.action_description,
      representation_description: tags.representation_description,
      prerequisite_description: tags.prerequisite_description,
      embedding,
      status: "pending_review",
    });
    log(`loaded ${kw.id} d=${cell.difficulty} rep=${cell.representation}`);
  }
}

async function main() {
  const unit = arg("--unit");
  const perKeyword = Number(arg("--perKeyword") ?? 5);
  const { data: keywords } = await supabase
    .from("learn_keywords")
    .select("*")
    .eq("category_id", unit)          // category == unit slug, per insert_*.sql
    .eq("tier", "in_depth")
    .eq("status", "approved");

  for (const kw of keywords ?? []) await generateForKeyword(kw, perKeyword);
}
main();
```

### 7.2 The verifier — `scripts/factory/verify.ts` (the missing safety net)

```ts
// Dual verification: deterministic CAS where possible, adversarial blind solver always.
// A problem ships only if BOTH agree the stated correct_index is correct.

import { spawnSync } from "node:child_process";

export async function verifyProblem(p: Problem): Promise<{ ok: boolean; reason?: string }> {
  // (a) SYMBOLIC — only for computable items. Best-effort; "unsupported" is not a failure.
  const cas = casCheck(p);
  if (cas.status === "contradiction") return { ok: false, reason: `CAS: ${cas.detail}` };

  // (b) ADVERSARIAL BLIND SOLVER — second model sees the problem WITHOUT the answer key.
  const blind = await callLLM(
    `Solve this multiple-choice problem. Return ONLY the index (0-3) of the correct choice.\n\n` +
    `Problem: ${p.latex_content}\nChoices:\n` +
    p.choices!.map((c, i) => `${i}: ${c}`).join("\n"),
    { model: "small", schema: { type: "object", properties: { index: { type: "integer" } }, required: ["index"] } }
  );
  if (blind.index !== p.correct_index) {
    return { ok: false, reason: `blind solver chose ${blind.index}, key says ${p.correct_index}` };
  }

  // (c) DISTRACTOR SANITY — all choices numerically/symbolically distinct, key included.
  if (new Set(p.choices!.map(normalizeLatex)).size !== p.choices!.length) {
    return { ok: false, reason: "duplicate choices" };
  }
  return { ok: true };
}

// SymPy bridge: expand/simplify and compare. Returns "ok" | "contradiction" | "unsupported".
function casCheck(p: Problem): { status: string; detail?: string } {
  const res = spawnSync("python3", ["scripts/factory/cas_check.py"], {
    input: JSON.stringify({ latex: p.latex_content, choice: p.choices![p.correct_index!] }),
    encoding: "utf8",
  });
  try { return JSON.parse(res.stdout); } catch { return { status: "unsupported" }; }
}
```

`cas_check.py` is a thin SymPy script: parse the LaTeX (e.g. via `sympy.parsing.latex`), and for factoring/simplification/solving keywords, assert `expand(answer) == expand(target)` or `solveset` membership. Return `{"status": "ok"|"contradiction"|"unsupported"}`. Keep it conservative — only claim `contradiction` when you're sure, so you never reject a correct-but-unparseable problem.

### 7.3 Diagnostic blueprint — `scripts/factory/build-diagnostic.ts`

```ts
// Selects the minimal anchor set: one (or two) probe problem per umbrella,
// at medium difficulty, highest-rated/most-central in-depth keyword.
// Output drives the DAG-walk diagnostic. These get 100% human review.

async function buildBlueprint() {
  const umbrellas = await getUmbrellaKeywords(); // tier='umbrella'
  const anchors = [];
  for (const u of umbrellas) {
    const centerKw = await mostCentralInDepth(u);     // highest prereq-degree child
    const probe = await supabase.from("rag_examples")
      .select("*")
      .contains("keyword_weights", { [centerKw.id]: 0 }) // has this keyword
      .eq("status", "approved")
      .gte("difficulty", 3).lte("difficulty", 3)         // medium
      .order("avg_rating", { ascending: false })
      .limit(1).single();
    if (probe.data) anchors.push({ umbrella: u.id, problemId: probe.data.id });
  }
  // persist as learn_diagnostic_problems (existing table/seeding script)
  await replaceDiagnosticSet(anchors);
}
```

### 7.4 Prerequisite DAG (P3) — the artifact that shortens the diagnostic

```ts
// packages/constants/precalcPrereqDag.ts
// Hand-curated (AI-drafted) edges: "to attempt X you should be able to do Y".
// Drives both diagnostic pruning and lesson routing.

export const PRECALC_PREREQ_DAG: Record<string /*umbrella*/, string[] /*prereq umbrellas*/> = {
  exponent_rules: [],
  polynomials: ["exponent_rules", "algebraic_expressions"],
  gcf_factoring_and_grouping: ["polynomials"],
  quadratic_and_special_form_factoring: ["gcf_factoring_and_grouping"],
  radicals: ["exponent_rules"],
  rational_exponents: ["radicals", "exponent_rules"],
  rational_functions: ["polynomials", "gcf_factoring_and_grouping"],
  exponential_and_logarithmic_functions: ["exponent_rules", "inverse_functions"],
  // ... fill for all 9 units
};
```

The diagnostic walk consumes this: topologically sort, probe foundations first, and prune downstream umbrellas when a foundation comes back weak (Section 4, Principle 3).

---

## 8. What to decide before building

1. **Generation model & verifier model** — small model for both is almost certainly enough given dual verification; confirm with the P0 polynomial parity test.
2. **CAS coverage** — which keyword families are CAS-verifiable (factoring, simplification, solving, derivatives = yes; graph-reading, modeling = blind-solver only). This determines how much you lean on the adversarial check.
3. **Review budget** — confirm the policy: 100% review for diagnostic anchors, sampled 5–10% for practice. This is the only ongoing human cost; size it deliberately.
4. **Where the DAG lives** — `packages/constants` (static) vs. derived from `learn_keywords.prerequisite_weights`. Static is simpler to reason about for the diagnostic; derived avoids drift. Recommend static to start, reconcile later.

---

## Appendix — Mapping to existing code

| Pipeline step | Reuse / extend |
|---------------|----------------|
| Generate | `apps/admin/app/api/generate-problem/route.ts` prompt + `PROBLEM_SCHEMA` |
| Validate | `apps/admin/lib/ragProblemParser.ts` |
| Tag | `apps/admin/lib/ai/keywordTagger.ts` (`autoTagKeywords`) |
| Embed | `scripts/seed-problem-embeddings.ts` pattern |
| Load | `rag_examples` insert (see `insert_polynomials.sql` shape) |
| Diagnostic runtime | `apps/student/app/demo/page.tsx` selection + `apps/student/lib/diagnosticScoring.ts` (extend to DAG walk) |
| Variants (Tier 4) | `generateVariantFromTemplate` — already live |
| Diagnostic seed table | `scripts/seed-learn-keywords.ts` → `learn_diagnostic_problems` |
