# Admin App

Port 3001. Problem authoring, keyword management, RAG agent, tagging tools.

## Pages

- **`/input`** — Paste problem JSON with live KaTeX preview; inserts directly into `rag_examples` (auto-tags on insert)
- **`/generate`** — Problem authoring (MCQ/FRQ generation via OpenAI)
- **`/rag-agent`** — Batch MCQ generation from PDF templates using `rag_examples`
- **`/keywords`** — Keyword management (add, approve, dedup, embed, seed representation keywords)
- **`/tagging`** — Retroactively tag problems with keyword_weights
- **`/compare`** — Side-by-side problem comparison
- **`/lookup`** — Direct ID-based problem/rag_example lookup
- **`/preview-json`** — Paste/load problem JSON to preview rendering and tag keywords across all four dimensions; "Auto-tag preview" button runs a dry-run via `POST /api/rag-examples/tag-preview` without inserting

## Problem Authoring Workflow

See `notes/problem-format.txt` for the full JSON template.

**Step 1 — Create**: Write the JSON with content fields + four keyword description fields. Use `/input` to paste and preview before inserting.

**Step 2 — Auto-tag** (fires on insert via `/input`, `/rag-examples`, or `/rag-agent`):

| Description field | → Column | Method |
|---|---|---|
| `topic_description` | `keyword_weights` | Embedding = description + latex + solution; cosine top-20 + LLM rerank |
| `action_description` | `action_weights` | LLM rerank, `action_items` category |
| `representation_description` | `representation_weights` | LLM rerank, `representations` category |
| `prerequisite_description` | `prerequisite_weights` | LLM rerank, topic keyword pool |
| `wrong_answer_data[i].description` | `wrong_answer_data[i].keyword_weights` | Cosine top-4 from topic pool; stored back as position-indexed array |

Auto-tagging: `apps/admin/lib/ai/keywordTagger.ts` → `autoTagKeywords()`.

**Step 3 — Review (optional)**: Use `/preview-json` → "Auto-tag preview" to dry-run tagging before insertion, or inspect/override weights in the four keyword tabs after insertion.

## Four-Dimensional Keyword System

Each problem carries four independent keyword dimensions:

| Dimension | Column | Category | Tracks |
|---|---|---|---|
| Topic | `keyword_weights` | all non-action categories | What skill/concept is tested |
| Action | `action_weights` | `action_items` | What cognitive verb the student performs |
| Representation | `representation_weights` | `representations` | How the problem is presented |
| Prerequisite | `prerequisite_weights` | all non-action categories | Prior knowledge required |

**Keyword query strategy in `autoTagKeywords()`:**
- Topic + prerequisite: queried with `tier = 'in_depth'` + `status = 'approved'`
- Action + representation: queried in a **separate call without tier constraint** — their category defines the dimension

**Representation keywords** (symbolic, verbal, contextual, graphical, tabular, diagram, exact_form, approximate_form) must be seeded before tagging works:
1. Run `insert_representations.sql` against Supabase
2. Click "Embed unembedded keywords" in admin `/keywords` page

## Key Components

- **`Preview.tsx`** — Core renderer: tokenizes `$...$` / `$$...$$` via KaTeX, handles `<SlopeField />` and `<FunctionGraph />` XML tags
- **`SlopeField.tsx`** — SVG slope field for differential equations
- **`FunctionGraph.tsx`** — SVG function plotter (uses `safeExpression.ts`)
