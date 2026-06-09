# Content Pipeline: Embedding, Tagging & Generation

Read when working on `rag_examples` enrichment, keyword tagging, or on-demand learn content (lessons/refreshers/tips/problems).

## Embedding & Tagging Pipeline
Problems in `rag_examples` are background-enriched after insert:
1. **Embedding** (`embedding` column, 1536 dims) — `text-embedding-3-small` on `latex_content + solution_latex`.
2. **Keyword weights** — `autoTagKeywords()` in `apps/admin/lib/ai/keywordTagger.ts` fills four JSONB columns: `keyword_weights` (topic/skill), `action_weights` (cognitive action), `representation_weights` (format), `prerequisite_weights` (prerequisite knowledge).
3. **Descriptions** — LLM generates `topic_description`, `action_description`, `representation_description`, `prerequisite_description`.
4. **Problem description** — `problem_description` generated if not provided.

Both `apps/admin/app/api/rag-examples/route.ts` and `apps/admin/app/api/problems/route.ts` use `export const runtime = "nodejs"` so the fire-and-forget background task survives after the response is sent.

**Prerequisite:** `learn_keywords` must have rows with non-null `embedding`. Run `POST /api/learn/embed-keywords` if keyword weights come back empty.

**Schema gotcha:** `learn_keywords` uses `category_id` (not `topic_id`) to link keywords to categories. Selecting the nonexistent `topic_id` makes Supabase return `null` (silent 404 on keyword lookups). Every route querying `learn_keywords` must select `category_id`; the `KwMeta` type in `apps/student/lib/learnGenerator.ts` uses `category_id`.

## Learn Content Generation
Lessons, refreshers, tips, and practice problems are generated on-demand and cached in the DB. All generators live in `apps/student/lib/learnGenerator.ts`.

| DB table | Content | Generator |
|---|---|---|
| `learn_lessons` | Micro-step lessons (3–4 steps, **every step has `has_check: true`**) | `generateAndStoreLesson` |
| `learn_refreshers` | Quick refresher (rule + example + one check) | `generateAndStoreRefresher` |
| `learn_tips` | Single-sentence tips after wrong answers | `generateAndStoreTip` |
| `learn_practice_problems` | Keyword-specific MCQ practice | `generateAndStoreProblems` |
| `learn_mastery_quiz_problems` | 4-question mastery quiz (difficulty 3–4) | `generateAndStoreMasteryQuiz` |

Each route checks the DB first and only generates if the row is missing. **Delete the row to force regeneration.**

**Generator client / model:** uses `OPENAI_API_KEY` (standard OpenAI endpoint) with `GEN_MODEL = "gpt-5.4-mini"`. Note: `gpt-5.5-mini` does **not** exist on this account and returns `404 model_not_found` (500s all generation) — do not set it without confirming access. An even earlier version used `GEMINI_API_KEY` with the Gemini OpenAI-compat endpoint, which also 500'd on an invalid model name.

### LaTeX format contract (current)
All generated content uses one universal format (the shared `FORMAT_RULES` in `learnGenerator.ts`):
- **Prose is plain text — never `\text{}`.** (Older builds wrapped prose in `\text{}`, which broke line wrapping in the renderer; that is no longer used.)
- **Math inline in `$...$`**; displayed/multi-step math in `$$...$$` or `$$\begin{aligned}...\end{aligned}$$`.
- Plain prose must contain no `\`, `^`, `_`, or `{}` — anything needing those goes inside `$...$`.
- No forced `\n\n` line breaks; write it the way you'd write it on paper.

The renderer (`apps/student/components/Preview.tsx`) splits on `$`/`$$`, renders prose as wrapping text and math via KaTeX, and extracts `<FunctionGraph .../>` tags. Graphs are only included for genuinely visual skills (graphing/transformations/intervals) — not for algebraic manipulation (expanding/FOIL/factoring). Sanitizers `fixBackslashEscaping` and `fixTabCorruptedText` defensively repair any stray over-escaped commands or `<TAB>ext{` → `\text{`.

**MicroStep schema:** each step has `has_check: boolean` (all `true`), a real `check_question` (text field is `latex_content`, not `question_latex`), and `hint_latex`. Distractors must reflect real student mistakes; examples must include "why" reasoning.

### Infinite problems (`apps/student/app/api/learn/practice/next/route.ts`)
Three-tier fallback: (1) serve cached `learn_practice_problems`; (2) generate + store via `generateAndStoreProblems`; (3) pick a random `rag_examples` template and generate a variant via `generateVariantFromTemplate`, stored in `problems` with `is_sibling: true`. The `problems.parent_problem_id` FK (`supabase/migrations/add_parent_problem_id.sql`) tracks variant lineage; `rag_examples`-sourced variants don't set it (separate UUID spaces) and rely on `is_sibling: true`.
