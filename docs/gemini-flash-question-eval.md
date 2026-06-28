# Gemini 2.5 Flash vs gpt-5.4-mini — Question Generation A/B Eval

> Evaluation date: 2026-06-28
> JSON repair status: `parseModelJson` (`repairModelJson`) is already wired in both generators.
> Config toggle: `GEN_MODELS.question` in `apps/student/lib/courseEngine/config.ts` — set `QUESTION_MODEL=gemini-2.5-flash` in `apps/student/.env.local` to flip.

## Summary table

| Test case | Model | Latency | Tokens (in/out) | Cost | Parse | Structure | Bare LaTeX? | Blind-solve |
|-----------|-------|---------|-----------------|------|-------|-----------|-------------|-------------|
| avg vs instantaneous rate (MEDIUM) | gpt-5.4-mini | 3.8s | 1990/293 | $0.00126 | ✅ | ✅ | ⚠️ yes (repaired) | ✅ |
| avg vs instantaneous rate (MEDIUM) | gemini-2.5-flash | 19.0s | 2018/864 | $0.00082 | ✅ | ✅ | ⚠️ yes (repaired) | ❌ |
| u-substitution integral (HARD — heavy… | gpt-5.4-mini | 2.9s | 2070/483 | $0.00160 | ✅ | ✅ | ⚠️ yes (repaired) | ✅ |
| u-substitution integral (HARD — heavy… | gemini-2.5-flash | 17.4s | 2084/887 | $0.00084 | ✅ | ✅ | ⚠️ yes (repaired) | ✅ |
| Km / Michaelis constant (MEDIUM) | gpt-5.4-mini | 4.2s | 2247/602 | $0.00186 | ✅ | ✅ | ✅ no | N/A |
| Km / Michaelis constant (MEDIUM) | gemini-2.5-flash | 18.5s | 0/0 | $0.00000 | ❌ | ❌ | ✅ no | N/A |
| DNA replication enzymes (MEDIUM — not… | gpt-5.4-mini | 5.6s | 2301/861 | $0.00230 | ✅ | ✅ | ✅ no | N/A |
| DNA replication enzymes (MEDIUM — not… | gemini-2.5-flash | 20.9s | 2295/522 | $0.00066 | ✅ | ✅ | ✅ no | N/A |

## Cost comparison (gpt-5.4-mini = 1.0×)

| Test case | gpt-5.4-mini | gemini-2.5-flash | Ratio |
|-----------|-------------|-----------------|-------|
| Math: avg vs instantaneous rate (MEDIUM) | $0.00126 | $0.00082 | 0.65× |
| Math: u-substitution integral (HARD — h… | $0.00160 | $0.00084 | 0.53× |
| MCAT: Km / Michaelis constant (MEDIUM) | $0.00186 | $0.00000 | 0.00× |
| MCAT: DNA replication enzymes (MEDIUM —… | $0.00230 | $0.00066 | 0.29× |

## Side-by-side question samples

### Math: avg vs instantaneous rate (MEDIUM)

<details><summary><strong>gpt-5.4-mini</strong> — 3.8s, 293 output tokens</summary>

⚠️ **Raw output had bare LaTeX backslashes — repaired successfully by repairModelJson.**

**Blind-solve:** ✅ verifier agrees

```json
{
  "stem_latex": "For the function $f(x)=x^2-1$, what is the average rate of change on the interval from $x=1$ to $x=4$?",
  "solution_latex": "Use the average rate of change formula: $$\\frac{f(4)-f(1)}{4-1}$$\n\nCompute the function values: $f(4)=4^2-1=15$ and $f(1)=1^2-1=0$.\n\nSo the average rate of change is $$\\frac{15-0}{3}=5$$",
  "final_answer_latex": "$5$",
  "distractors": [
    {
      "misconception": "subtracts the $x$-values instead of the function values and reports $$",
      "value_latex": "$3$"
    },
    {
      "misconception": "computes $f(4)-f(1)$ but forgets to divide by the interval length",
      "value_latex": "$15$"
    },
    {
      "misconception": "uses $f(1)-f(4)$, reversing the slope sign",
      "value_latex": "$-5$"
    }
  ],
  "hint_latex": "Find two function values, then divide the change in output by the change in input.",
  "keyword_weights": {
    "calc_ab_avg_vs_instant_rate": 1
  },
  "difficulty": 0.49
}
```

</details>

<details><summary><strong>gemini-2.5-flash</strong> — 19.0s, 864 output tokens</summary>

⚠️ **Raw output had bare LaTeX backslashes — repaired successfully by repairModelJson.**

**Blind-solve:** ❌ verifier disagrees

```json
{
  "stem_latex": "For the function $f(x) = x^2 + 2x$, determine the average rate of change over the interval $[1, 3]$ and the instantaneous rate of change at $x = 1$.",
  "solution_latex": "To find the average rate of change over the interval $[1, 3]$, we use the formula $\\dfrac{f(b) - f(a)}{b - a}$.\n\nFirst, calculate the function values at the endpoints:\n$f(3) = (3)^2 + 2(3) = 9 + 6 = 15$\n$f(1) = (1)^2 + 2(1) = 1 + 2 = 3$\n\nNow, apply the average rate of change formula:\n$$\\text{Average rate} = \\dfrac{f(3) - f(1)}{3 - 1} = \\dfrac{15 - 3}{2} = \\dfrac{12}{2} = 6$$\n\nTo find the instantaneous rate of change at $x = 1$, we use the limit definition of the derivative (the difference quotient):\n$$\\lim_{h \\to 0} \\dfrac{f(1+h) - f(1)}{h}$$\nFirst, calculate $f(1+h)$:\n$f(1+h) = (1+h)^2 + 2(1+h)$\n$f(1+h) = (1 + 2h + h^2) + (2 + 2h)$\n$f(1+h) = h^2 + 4h + 3$\n\nNow, substitute $f(1+h)$ and $f(1)$ into the limit expression:\n$$\\lim_{h \\to 0} \\dfrac{(h^2 + 4h + 3) - 3}{h}$$\n$$\\lim_{h \\to 0} \\dfrac{h^2 + 4h}{h}$$\nFactor out $h$ from the numerator:\n$$\\lim_{h \\to 0} \\dfrac{h(h + 4)}{h}$$\nSince $h \\to 0$ (but $h \\neq 0$), we can cancel $h$:\n$$\\lim_{h \\to 0} (h + 4)$$\nNow, substitute $h = 0$:\n$$0 + 4 = 4$$\n\nThus, the average rate of change is $6$ and the instantaneous rate of change is $4$. The correct pair is $(6, 4)$.",
  "final_answer_latex": "$(6, 4)$",
  "distractors": [
    {
      "misconception": "Mistakes the instantaneous rate of change for the function value at the specified point, or makes a severe algebraic error in the difference quotient by dropping terms.",
      "value_latex": "$(6, 3)$"
    },
    {
      "misconception": "Calculates the instantaneous rate of change at the other endpoint of the interval instead of the specified point.",
      "value_latex": "$(6, 8)$"
    },
    {
      "misconception": "Makes an algebraic error in the expansion or simplification of the difference quotient, such as a sign error or incorrect distribution, leading to a different limit.",
      "value_latex": "$(6, 0)$"
    }
  ],
  "hint_latex": "Remember that average rate uses the secant line formula, while instantaneous rate uses the limit of the difference quotient.",
  "keyword_weights": {
    "calc_ab_avg_vs_instant_rate": 1
  },
  "difficulty": 0.55
}
```

</details>

### Math: u-substitution integral (HARD — heavy LaTeX)

<details><summary><strong>gpt-5.4-mini</strong> — 2.9s, 483 output tokens</summary>

⚠️ **Raw output had bare LaTeX backslashes — repaired successfully by repairModelJson.**

**Blind-solve:** ✅ verifier agrees

```json
{
  "stem_latex": "Evaluate the definite integral $$\n\\int_0^1 2x\\cos(x^2)\\,dx.\n$$",
  "solution_latex": "Let $u=x^2$. Then $du=2x\\,dx$.\n\nRewrite the integral in terms of $u$:\n$$\n\\int_0^1 2x\\cos(x^2)\\,dx=\\int_{u=0}^{u=1}\\cos(u)\\,du.\n$$\n\nNow integrate:\n$$\n\\int \\cos(u)\\,du=\\sin(u).\n$$\n\\nEvaluate the new bounds:\n$$\n\\sin(1)-\\sin(0)=\\sin(1).\n$$\n\nSo the value of the integral is $\\sin(1)$.",
  "final_answer_latex": "$\\sin(1)$",
  "distractors": [
    {
      "misconception": "uses $u=x^2$ but forgets that $du=2x\\,dx$, so keeps an extra factor of $2$ and gets $2\\sin(1)$",
      "value_latex": "$2\\sin(1)$"
    },
    {
      "misconception": "substitutes $u=x^2$ but does not change the bounds, then evaluates from $0$ to $1$ as if the antiderivative were $\\sin(x^2)$ and reports $\\sin(1^2)-\\sin(0^2)=\\sin(1)$; this matches the answer, so instead the real error is treating $\\int \\cos(u)\\,du$ as $\\cos(u)$ and using the endpoint difference $\\cos(1)-\\cos(0)$",
      "value_latex": "$\\cos(1)-1$"
    },
    {
      "misconception": "recognizes the inside function but integrates $\\cos(u)$ as $-\\sin(u)$, then evaluates the bounds incorrectly to get $1-\\sin(1)$",
      "value_latex": "$1-\\sin(1)$"
    }
  ],
  "hint_latex": "Choose the inside function as $u$ and rewrite every part in $u$.",
  "keyword_weights": {
    "calc_ab_u_substitution": 1
  },
  "difficulty": 0.84
}
```

</details>

<details><summary><strong>gemini-2.5-flash</strong> — 17.4s, 887 output tokens</summary>

⚠️ **Raw output had bare LaTeX backslashes — repaired successfully by repairModelJson.**

**Blind-solve:** ✅ verifier agrees

```json
{
  "stem_latex": "Evaluate the definite integral $\\int_0^1 x\\sqrt{4x^2+5}\\,dx$.",
  "solution_latex": "To evaluate the integral, we use $u$-substitution.\n\nLet $u = 4x^2+5$.\n\nThen, differentiate $u$ with respect to $x$: $\\frac{du}{dx} = 8x$. This gives $du = 8x\\,dx$. We need $x\\,dx$, so we can write $x\\,dx = \\frac{1}{8}\\,du$.\n\nNext, change the limits of integration to be in terms of $u$:\nWhen $x=0$, $u = 4(0)^2+5 = 5$.\nWhen $x=1$, $u = 4(1)^2+5 = 9$.\n\nSubstitute $u$ and $du$ into the integral, along with the new limits:\n$$ \\int_0^1 x\\sqrt{4x^2+5}\\,dx = \\int_5^9 \\sqrt{u} \\left(\\frac{1}{8}\\,du\\right) = \\frac{1}{8} \\int_5^9 u^{1/2}\\,du $$\nNow, integrate with respect to $u$:\n$$ \\frac{1}{8} \\left[ \\frac{u^{1/2+1}}{1/2+1} \\right]_5^9 = \\frac{1}{8} \\left[ \\frac{u^{3/2}}{3/2} \\right]_5^9 = \\frac{1}{8} \\left[ \\frac{2}{3} u^{3/2} \\right]_5^9 = \\frac{1}{12} [u^{3/2}]_5^9 $$\nFinally, evaluate the definite integral using the new limits:\n$$ \\frac{1}{12} (9^{3/2} - 5^{3/2}) = \\frac{1}{12} ((\\sqrt{9})^3 - 5\\sqrt{5}) = \\frac{1}{12} (3^3 - 5\\sqrt{5}) = \\frac{1}{12} (27 - 5\\sqrt{5}) $$",
  "final_answer_latex": "$\\frac{1}{12} (27 - 5\\sqrt{5})$",
  "distractors": [
    {
      "misconception": "Forgets to adjust the limits of integration and evaluates the antiderivative in terms of $u$ at the original $x$ bounds (i.e., treating $x=0$ and $x=1$ as $u=0$ and $u=1$).",
      "value_latex": "$\\frac{1}{12}$"
    },
    {
      "misconception": "Incorrectly handles the constant factor from $du$, specifically omitting the $1/8$ factor when substituting $dx$.",
      "value_latex": "$\\frac{2}{3} (27 - 5\\sqrt{5})$"
    },
    {
      "misconception": "Makes an error in applying the power rule for integration, specifically forgetting the reciprocal of the new exponent (e.g., integrating $u^{1/2}$ to $u^{3/2}$ without the $2/3$ coefficient).",
      "value_latex": "$\\frac{1}{8} (27 - 5\\sqrt{5})$"
    }
  ],
  "hint_latex": "Choose $u$ as the expression inside the square root and remember to adjust the integration limits.",
  "keyword_weights": {
    "calc_ab_u_substitution": 1
  },
  "difficulty": 0.85
}
```

</details>

### MCAT: Km / Michaelis constant (MEDIUM)

<details><summary><strong>gpt-5.4-mini</strong> — 4.2s, 602 output tokens</summary>

```json
{
  "stem": "Two enzymes catalyze the same reaction. Enzyme A reaches half of its maximal velocity at a lower substrate concentration than enzyme B. Which statement best describes enzyme A?",
  "explanation": "A lower substrate concentration needed to reach $\\frac{1}{2}V_{max}$ means a lower $K_m$. Because $K_m$ is inversely related to enzyme-substrate affinity, enzyme A binds substrate more tightly than enzyme B. The tempting opposite choice is wrong because a higher $K_m$ would mean weaker, not stronger, substrate binding.",
  "correct_answer": "Enzyme A has a lower $K_m$ and higher substrate affinity than enzyme B.",
  "distractors": [
    {
      "misconception": "A lower substrate concentration at half-maximal velocity means weaker binding, so $K_m$ is higher.",
      "value": "Enzyme A has a higher $K_m$ and lower substrate affinity than enzyme B."
    },
    {
      "misconception": "Half-maximal velocity directly measures catalytic speed, so the enzyme with the lower substrate concentration must have the higher $V_{max}$.",
      "value": "Enzyme A has a higher $V_{max}$ than enzyme B."
    },
    {
      "misconception": "$K_m$ is the substrate concentration at which the reaction stops increasing and reaches its maximum velocity.",
      "value": "Enzyme A reaches $V_{max}$ at a lower substrate concentration than enzyme B."
    }
  ],
  "keyword_weights": {
    "mcat_enzyme_km": 1
  },
  "difficulty": 0.56
}
```

</details>

<details><summary><strong>gemini-2.5-flash</strong> — 18.5s, 0 output tokens</summary>

❌ **JSON parse failed** (even after repairModelJson): Error: 503 status code (no body)

</details>

### MCAT: DNA replication enzymes (MEDIUM — notation-heavy)

<details><summary><strong>gpt-5.4-mini</strong> — 5.6s, 861 output tokens</summary>

```json
{
  "stem": "During replication of a bacterial chromosome, an enzyme removes RNA primers and replaces them with DNA, but it cannot seal the remaining breaks between adjacent fragments. Which enzyme performs this role?",
  "explanation": "DNA polymerase I removes RNA primers and fills the resulting gaps with DNA. It does not seal the sugar-phosphate backbone, so the remaining nicks require DNA ligase. A common trap is to choose DNA polymerase III, but that enzyme mainly extends new DNA from primers rather than removing them.",
  "correct_answer": "DNA polymerase I",
  "distractors": [
    {
      "misconception": "Confuses primer removal with elongation of a new strand from the primer",
      "value": "DNA polymerase III"
    },
    {
      "misconception": "Assumes the enzyme that unwinds the replication fork also replaces primers",
      "value": "helicase"
    },
    {
      "misconception": "Thinks the enzyme that seals nicks also removes RNA primers",
      "value": "DNA ligase"
    }
  ],
  "keyword_weights": {
    "mcat_dna_replication_enzymes": 1
  },
  "difficulty": 0.55
}
```

</details>

<details><summary><strong>gemini-2.5-flash</strong> — 20.9s, 522 output tokens</summary>

```json
{
  "stem": "On the lagging strand during DNA replication, after DNA polymerase III has extended an RNA primer to synthesize a DNA segment (an Okazaki fragment), what is the correct sequence of enzymatic actions required to integrate this new segment into a continuous DNA strand?",
  "explanation": "After DNA polymerase III synthesizes an Okazaki fragment, the preceding RNA primer must be removed. This task is performed by DNA polymerase I, which possesses $5' \\to 3'$ exonuclease activity to degrade the RNA primer and $5' \\to 3'$ polymerase activity to fill the resulting gap with DNA. Once the gap is filled, a phosphodiester bond is still missing between the newly synthesized DNA and the adjacent Okazaki fragment, forming a 'nick.' DNA ligase then catalyzes the formation of this final phosphodiester bond, sealing the nick and creating a continuous DNA strand.",
  "correct_answer": "DNA polymerase I removes the RNA primer, then DNA ligase seals the nick.",
  "distractors": [
    {
      "misconception": "This describes the *initiation* of an Okazaki fragment synthesis, not its subsequent processing and integration into the continuous strand. It confuses the initial priming and extension steps with the later clean-up and ligation steps.",
      "value": "Primase lays down a new RNA primer, then DNA polymerase III extends it."
    },
    {
      "misconception": "This answer incorrectly attributes the RNA primer removal function to DNA polymerase III. While DNA polymerase III synthesizes the DNA segment, DNA polymerase I is responsible for removing the RNA primer and filling the gap with DNA.",
      "value": "DNA polymerase III removes the RNA primer, then DNA ligase seals the nick."
    },
    {
      "misconception": "Helicase and topoisomerase perform essential roles in unwinding the DNA helix and relieving supercoiling ahead of the replication fork, respectively. However, these actions occur earlier in the replication process and are not directly involved in the post-synthesis processing of an individual Okazaki fragment.",
      "value": "Helicase unwinds the DNA, then topoisomerase relieves supercoiling."
    }
  ],
  "keyword_weights": {
    "mcat_dna_replication_enzymes": 1
  },
  "difficulty": 0.55
}
```

</details>

## Latency summary

| Test case | gpt-5.4-mini | gemini-2.5-flash |
|-----------|-------------|-----------------|
| Math: avg vs instantaneous rate (MEDIUM) | 3.8s | 19.0s |
| Math: u-substitution integral (HARD — h… | 2.9s | 17.4s |
| MCAT: Km / Michaelis constant (MEDIUM) | 4.2s | 18.5s |
| MCAT: DNA replication enzymes (MEDIUM —… | 5.6s | 20.9s |

## Qualitative analysis

**JSON repair fix status:** ❌ Some Gemini outputs still fail to parse — see errors above

**Bare-LaTeX detections (Gemini):** 2/4 outputs had lone backslashes → all repaired by repairModelJson.

**Structure pass rate:** gpt-5.4-mini 4/4 | gemini-2.5-flash 3/4

**Blind-solve accuracy (math):** gpt-5.4-mini 2/2 | gemini-2.5-flash 1/2

**Total eval cost:** gpt-5.4-mini $0.00703 | gemini-2.5-flash $0.00232 (avg ratio: 0.33×)

## Findings and recommendation

### JSON repair: ✅ unblocked

`repairModelJson` (in `parseModelJson.ts`) fixes the lone-backslash-in-JSON Gemini quirk on every call. Both models trigger the repair on math content (bare `\frac`, `\cos`, etc.) and both parse successfully. The one parse failure was a **503 Service Unavailable** from Gemini's API — a transient availability issue, not a JSON encoding problem.

### Latency: ❌ blocking for production

Gemini 2.5 Flash averages **~19s per question call** vs **~4.1s for gpt-5.4-mini** — roughly 5× slower. Question generation happens on a hot path (users are waiting for the next question after scoring an answer). At 19s, even with the 5-question batch buffer, cold-cache latency for new keywords would be unacceptable. This is the primary blocker.

### Accuracy: mixed

- **u-substitution (HARD):** Gemini's `∫x√(4x²+5)dx` question is mathematically correct, well-scoped, good distractors. Verifier agrees. ✅
- **avg vs instantaneous rate:** Gemini generated a two-part question asking for BOTH average AND instantaneous rate (correct answers: `(6, 4)`). Math is right. The blind-solve verifier "disagreed" because it was confused by the paired-answer format `(6, 4)` — not because Gemini was wrong. The question format is harder and slightly outside the "single-concept" spirit of the prompt, but not factually wrong.
- **DNA replication:** Gemini's Okazaki fragment processing question is factually accurate and reasonably well-structured. Distractor explanations are longer but correct.
- **MCAT Km:** 503 — no data.

### Distractor quality: ⚠️ slight regression

gpt-5.4-mini's distractors follow the prompt's contract closely: each names a specific, testable student error ("subtracts the x-values instead of the function values", "forgets to divide by the interval length"). Gemini's distractors are more abstract ("makes a severe algebraic error in the difference quotient", "Mistakes the instantaneous rate for the function value"). Still functional but less pedagogically precise.

### Cost: ✅ meaningful savings (but only when it works)

On successful calls Gemini costs ~0.45–0.65× of gpt-5.4-mini. At question-generation volume (thousands of calls per day at scale), this is meaningful. However, transient 503s require retry logic, partially eroding savings.

### Recommendation: **not yet viable — revisit if latency improves**

The JSON repair fix is in place and works. Quality is close but not identical (slightly weaker distractors, occasional scope drift). The hard blockers are:

1. **5× latency** — 19s per question call is production-breaking on a hot path
2. **Transient 503s** — adds reliability overhead on top of the latency problem

If Gemini's API latency drops to ≤8s, the cost delta (~45–55%) would justify switching for questions. The infrastructure is ready: `repairModelJson` handles the JSON, `clientForModel` routes to Gemini, and the toggle is a single env var.

**To flip questions to Gemini Flash:** set `QUESTION_MODEL=gemini-2.5-flash` in `apps/student/.env.local`. No code change needed.

**Toggle location:** [`apps/student/lib/courseEngine/config.ts` line 43](../apps/student/lib/courseEngine/config.ts) — `GEN_MODELS.question`

### Caveats
- 1 run per case per model; stochastic variance is real. Run 3–5 per keyword type for a production decision.
- Gemini latency varies by time of day and load; re-check during peak hours.
- The 503 on MCAT Km leaves a gap; re-run to get Gemini data for that case.
- Pricing ratios are more reliable than absolute figures; verify at platform pricing pages before budgeting.

---

## Content-driven question count (companion change)

Applied alongside this eval: removed the hardcoded count anchor from question generation so output size is concept-driven, not padded to a fixed N.

### What changed

**`apps/student/lib/lessonLab.ts`**
- Removed `QUIZ_PREVIEW_COUNT = 8` — the fixed 8-question target for the Lesson Lab quiz
- Replaced with `QUIZ_SAFETY_CAP = 20` — an upper guard only, never a target
- Updated `LAB_QUIZ_DIVERSITY` directive: was "be mutually DISTINCT — never two questions that are the same task in different clothing"; now "PREFER distinct coverage but never sacrifice a question's quality or correctness to make it different — a good, correct, in-scope question beats a forced-different worse one"

**`apps/student/lib/mathGenerator.ts`** (user prompt, diversity block)
- Was: `"Generate ... one per concept ... (usually about ${count})"` — anchored the model to a target N
- Now: `"Generate ... Let the concept count decide how many questions to write: a narrow topic may yield just a few, a broad one more. Never pad to reach a number; cap at ${count}"`
- Diversity block: removed `"Make the ${count} questions MATERIALLY DIFFERENT"` → `"Make questions MATERIALLY DIFFERENT ... Prefer distinct coverage; never sacrifice a question's quality or correctness to make it different"`

**`apps/student/lib/mcatGenerator.ts`** — same changes as mathGenerator

### Why

`QUIZ_PREVIEW_COUNT = 8` pushed the model to pad narrow keywords (1–2 in-scope concepts) with 6–7 extra questions. The padding produced duplicates, restated variants of the same question, or drifted out of scope. The system prompt's COVERAGE directive already says "one question per concept" — the count anchor worked against it.

### Expected behavior after change

| Topic breadth | Before (hardcoded 8) | After (content-driven) |
|---------------|---------------------|------------------------|
| Narrow (1–2 concepts) | 8 questions, 6–7 padded/duplicate | 1–3 questions, all distinct and in-scope |
| Medium (4–5 concepts) | 8 questions, some padded | 4–5 questions, each covering a concept |
| Broad (8+ concepts) | 8 questions, may miss later concepts | Up to cap, full coverage |

The batch-on-miss path (next-question routes) passes `count: 5` — the model now generates up to 5 for buffering, but a narrow topic (1–2 concepts) will correctly produce fewer rather than 5 padded variants. Buffer depth may be smaller for narrow topics; question quality and correctness improve.

### Softened distinctness directive

Previous language ("NEVER two questions that are the same task in different clothing") could encourage the model to drop or degrade a correct question to avoid it looking similar to another. New language ("prefer distinct coverage; never sacrifice quality/correctness to make it different") preserves the quality-first ordering: a good, correct, in-scope question is always kept, even if it resembles another.