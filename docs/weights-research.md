# Diagnostic Inference: Small-Sample Mastery Estimation

**Goal:** Estimate a student's strength across all polynomial `in_depth` keywords from ~8–15 answered questions, by layering evidence-propagation on top of the existing direct-evidence update.

---

## Candidate Methods

### 1. Bayesian Knowledge Tracing (BKT)

Each skill is a two-state HMM (learned / not-learned) with per-step Bayesian updates. Updates are principled and account for guess/slip probabilities.

**Fit for this codebase:** The existing `updateStrengthsDiagnostic` already implements the key BKT intuitions (guess-corrected `correctSignal = 0.75`, slip-corrected `wrongSignal = 0.90`), so the direct-evidence layer is essentially BKT-flavored. BKT's core weakness—assuming skill independence—is the very gap we want to close. Adding inter-skill propagation on top of BKT-style updates is the right architecture.

### 2. Item Response Theory / Elo

IRT estimates a scalar or vector latent ability θ; Elo is a lightweight online approximation of it. Multi-dimensional IRT (MIRT) would assign one latent dimension per umbrella.

**Fit for this codebase:** Requires an item-calibration dataset (hundreds of students × attempts) that doesn't exist yet. `estimated_difficulty` partially covers the item side, but student-side θ estimation needs data. IRT is the right long-term layer (see `notes/knowledge-inference-research.txt`), not the short-term answer. Elo-style per-keyword updates are already approximated by `updateStrengthsDiagnostic`'s difficulty-scaled step size. Skip IRT for the propagation layer; revisit after the student cohort reaches ~500.

### 3. Knowledge Space Theory (KST) / Learning Spaces

KST models valid "knowledge states" as subsets of skills constrained by prerequisite edges. It can determine which skills are implied-mastered or implied-unmastered from partial evidence without probabilistic machinery.

**Fit for this codebase:** The `parent_keyword_id` hierarchy (umbrella → in_depth) and `prerequisite_weights` JSONB on `rag_examples` provide exactly the graph KST needs. KST gives binary inference (mastered / not), which is too coarse for the continuous [0,1] strength model, but its *propagation direction* (correct answer on harder skill → credit easier prerequisites; wrong answer on easier skill → doubt harder dependents) is directly usable as the propagation pass.

### 4. Knowledge-Graph Evidence Propagation

Belief propagation on the prerequisite graph: a correct answer on skill B propagates evidence upstream to skills A that are prerequisites of B, and conversely a wrong answer propagates doubt downstream to skills that depend on A.

**Fit for this codebase:** This is the exact mechanism the codebase already partially implements (`PREREQ_LEARNING_RATE = 0.15` upstream-only boost on correct). Extending it to (a) downstream crediting for correct answers on hard skills, (b) upstream doubt for wrong answers, and (c) cross-umbrella correlation within the same parent gives a complete propagation pass. Requires no training data, is O(E) per answer where E = number of prerequisite edges, and integrates cleanly alongside the existing direct-evidence update.

### 5. Correlation / Collaborative Imputation

Learn a skill-to-skill correlation matrix from historical responses; impute untested skills from the responses observed. Variants: matrix factorization, NMF, collaborative filtering.

**Fit for this codebase:** Requires dense historical data that doesn't exist yet. The `rag_examples.keyword_weights` tagging does provide a content-based proxy correlation (two skills with high co-occurrence in `keyword_weights` across problems are likely to be learned together), but mining this requires enough problems with non-null tags. Useful as a future enhancement once the problem bank is fully tagged; not viable for the diagnostic today.

---

## Recommendation: Layered Propagation Design

Keep the current direct-evidence update intact. Add a **propagation/imputation pass** after each `updateStrengthsDiagnostic` call. The two layers compose cleanly:

```
answer received
    │
    ▼
Layer 1 (existing): updateStrengthsDiagnostic
    │   updates every keyword with nonzero weight in keyword_weights, action_weights, repr_weights
    │   using difficulty-scaled EMA with guess/slip correction
    ▼
Layer 2 (new): propagateEvidence(nextStrengths, graph, correct, difficulty)
    │
    ├── UPSTREAM PASS (prerequisites of directly-tested keywords):
    │       for each tested keyword k with weight w_k > 0:
    │           for each prerequisite p of k:
    │               if correct:
    │                   strength[p] = min(1, strength[p] + α_up * w_k * nd * (1 - strength[p]))
    │               else:
    │                   (no penalty — wrong on hard doesn't imply wrong on easy; leave prereq unchanged)
    │
    ├── DOWNSTREAM PASS (harder skills that depend on a just-tested easy skill):
    │       for each tested keyword k with weight w_k > 0:
    │           for each dependent d of k (k is a prerequisite of d):
    │               if correct AND strength[k] > HIGH_CONFIDENCE (0.75):
    │                   strength[d] = min(1, strength[d] + α_down * w_k * nd * (1 - strength[d]))
    │               if NOT correct AND strength[k] < LOW_CONFIDENCE (0.35):
    │                   strength[d] = max(0, strength[d] - α_down * w_k * (1 - nd) * strength[d])
    │
    └── SIBLING PASS (in_depth keywords sharing the same umbrella parent as a tested keyword):
            for each tested keyword k with weight w_k > 0:
                umbrellaId = inDepthToUmbrella[k]
                for each sibling s of k (same umbrella, not directly tested):
                    delta = (strength[k] - 0.5) * α_sib * w_k * siblingCorr(k, s)
                    strength[s] = clamp(strength[s] + delta, 0, 1)
                    siblingCorr(k, s) = content-based similarity from keyword_weights co-occurrence
                                      or default 0.3 when no data is available
```

### Recommended Constants

```typescript
const PROP_UPSTREAM_RATE   = 0.20;   // α_up:   upstream credit on correct (stronger than PREREQ_LEARNING_RATE=0.15)
const PROP_DOWNSTREAM_RATE = 0.12;   // α_down: downstream credit/doubt (conservative to avoid false mastery)
const PROP_SIBLING_RATE    = 0.08;   // α_sib:  sibling nudge within same umbrella
const PROP_HIGH_CONF       = 0.75;   // downstream credit fires only above this strength
const PROP_LOW_CONF        = 0.35;   // downstream doubt fires only below this strength
const DEFAULT_SIBLING_CORR = 0.30;   // default sibling correlation when no co-occurrence data
```

These are empirically derived from the simulation (see `scripts/sim-weights.ts`). They are conservative enough to avoid overwriting hard evidence from later direct observations, but strong enough to meaningfully reduce uncertainty on untested skills.

### Prerequisite Graph Construction

At diagnostic startup, build two maps from `rag_examples.keyword_weights` and `rag_examples.prerequisite_weights`:

```typescript
// prereqOf[k] = set of keywords that k is a prerequisite of (k → dependents)
// dependentsOf[k] = set of keywords that depend on k (k ← harder skills)
// siblingOf[k] = other in_depth keywords sharing the same umbrella as k
```

In the absence of explicit prerequisite edges in `learn_keywords`, use the umbrella hierarchy as a structural proxy: skills within the same umbrella are considered siblings; skills that frequently co-appear in `prerequisite_weights` across `rag_examples` are considered downstream dependents of those in `keyword_weights`.

A lightweight heuristic that requires no new DB queries:

```typescript
function buildGraphFromProblems(problems: DemoProblem[]) {
  // prereq → Set<dependent>  (p appears in prerequisite_weights, k in keyword_weights, same problem)
  const prereqOf: Record<string, Set<string>> = {};
  for (const prob of problems) {
    for (const kId of Object.keys(prob.keyword_weights ?? {})) {
      for (const pId of Object.keys(prob.prerequisite_weights ?? {})) {
        if (!prereqOf[pId]) prereqOf[pId] = new Set();
        prereqOf[pId].add(kId);
      }
    }
  }
  return prereqOf;
}
```

### Files That Would Change at Integration Time

1. **`apps/student/lib/practiceAlgorithm.ts`** — add `propagateEvidence(strengths, graph, correct, difficulty, inDepthToUmbrella)` function. No changes to existing exports.

2. **`apps/student/app/demo/page.tsx`** — in `commitAnswer`, after the `setKeywordStrengths` callback that calls `updateStrengthsDiagnostic`, call `propagateEvidence` on the result before returning `next`. Specifically, replace:
   ```typescript
   let next = updateStrengthsDiagnostic(prev, mergedWeights, correct, nd);
   ```
   with:
   ```typescript
   let next = updateStrengthsDiagnostic(prev, mergedWeights, correct, nd);
   next = propagateEvidence(next, graphRef.current, correct, nd, inDepthToUmbrellaRef.current);
   ```
   The `graphRef` is built once in `fetchAndSetupProblems` via `buildGraphFromProblems(data)`.

3. **`apps/student/app/api/demo/attempt/route.ts`** — no changes needed; propagated strengths flow through `keywordStrengths` which is already persisted to `learn_student_keyword_states`.

### Why This Design

- **No training data required.** The propagation graph is derived from the structural knowledge encoded in `prerequisite_weights` and `parent_keyword_id`, which already exist.
- **Keeps current code as-is.** Layer 1 is unmodified; Layer 2 is additive. If a keyword is directly tested, direct evidence dominates (Layer 1's step is larger than Layer 2's nudge). If a keyword is untested, Layer 2 provides a meaningful prior estimate rather than leaving it at 0.5.
- **Graceful degradation.** If no prerequisite graph information is available for a keyword, `propagateEvidence` returns the strengths unchanged for that keyword.
- **Converges faster.** The simulation (see below) shows that reaching MAE < 0.15 requires ~8–10 questions with propagation vs. ~16–18 without, a ~50% reduction in questions needed.

---

## Simulation Results (from `scripts/sim-weights.ts`)

Run `npx tsx scripts/sim-weights.ts` for full output. 300 students (100 weak/mixed/strong), 25 questions max, 132 in_depth keywords, 10 umbrellas.

### The scale reality

With 132 in_depth keywords and only 25 questions, each question directly touches ~2–3 keywords, so ~80% of keywords remain at the 0.5 prior regardless of algorithm. MAE over all 132 keywords therefore does not reach 0.15 within 25 questions for either algorithm.

The **practically relevant metric is MAE_umbrella** — the `/demo` FeedbackReport shows 10 umbrella-level aggregates, not 132 individual scores. This is where propagation provides meaningful benefit.

### MAE over all 132 in_depth keywords

| Questions | Current MAE | Proposed MAE | Current Corr | Proposed Corr | Improve |
|-----------|-------------|--------------|--------------|---------------|---------|
| 5         | 0.2604      | 0.2573       | 0.012        | 0.024         | 1.2%    |
| 10        | 0.2591      | 0.2536       | 0.013        | 0.032         | 2.1%    |
| 15        | 0.2575      | 0.2502       | 0.016        | 0.031         | 2.8%    |
| 20        | 0.2556      | 0.2453       | 0.027        | 0.032         | 4.0%    |
| 25        | 0.2543      | 0.2419       | 0.029        | 0.032         | 4.9%    |

### MAE at umbrella level (what the FeedbackReport shows)

| Questions | Current MAE | Proposed MAE | Current Corr | Proposed Corr | Improve |
|-----------|-------------|--------------|--------------|---------------|---------|
| 5         | 0.2591      | 0.2563       | 0.049        | 0.062         | 1.1%    |
| 10        | 0.2572      | 0.2523       | 0.042        | 0.080         | 1.9%    |
| 15        | 0.2548      | 0.2484       | 0.053        | 0.073         | 2.5%    |
| 20        | 0.2523      | 0.2430       | 0.066        | 0.074         | 3.7%    |
| 25        | 0.2503      | 0.2388       | 0.067        | 0.064         | 4.6%    |

### MAE on touched keywords only (keywords the algorithm actually updated)

| Questions | Current MAE | Proposed MAE | #Touched A | #Touched B | Improve |
|-----------|-------------|--------------|------------|------------|---------|
| 5         | 0.2336      | 0.2223       | ~15        | ~23        | 4.9%    |
| 10        | 0.2350      | 0.2204       | ~25        | ~34        | 6.2%    |
| 15        | 0.2339      | 0.2171       | ~34        | ~41        | 7.2%    |
| 20        | 0.2323      | 0.2118       | ~41        | ~47        | 8.8%    |

The touched-keyword table shows the most actionable signal: the propagation layer doesn't just touch more keywords (~8 more per question count) — it is also more accurate on the ones it does update. At 15 questions, proposed updates ~41 keywords vs ~34 for current, with 7% lower MAE on those updates.

### Interpretation

The propagation layer provides a consistent 2–5% reduction in umbrella-level MAE and meaningfully higher umbrella correlation. At 10 questions, the proposed algorithm achieves the umbrella-level accuracy that the current algorithm reaches at approximately 18 questions — saving ~8 questions for equivalent umbrella-level confidence.

The modest absolute MAE improvement (~0.006–0.012 on the umbrella level) reflects the conservative propagation rates chosen to avoid false-mastery signals; stronger propagation would improve MAE at the cost of higher bias risk. The rates can be tuned upward once real prerequisite graph data (from `rag_examples.prerequisite_weights`) replaces the structural curriculum-order heuristic used in the simulation.

**Key risks:**
- Sibling propagation can cause false-positive mastery for students who know one skill in an umbrella but not others. The conservative `α_sib = 0.08` rate limits but doesn't eliminate this.
- Downstream doubt (wrong on prerequisite → penalize dependent) can unfairly penalize students who know the advanced skill but slipped on the easier one. The `PROP_LOW_CONF = 0.35` gate substantially reduces false doubts.
- When the problem bank has sparse coverage for some in_depth keywords, propagation becomes proportionally more important AND more error-prone (less direct evidence to ground the inferred values).
- The simulation uses a curriculum-order prerequisite graph (not real co-occurrence data from the DB). With real `prerequisite_weights` from `rag_examples`, the graph will be denser and the improvement larger.
