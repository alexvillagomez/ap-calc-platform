# Playbook — Adding a New Section to `/mcat`

How to add a whole new discipline **section** (Biology → Psych/Soc → Chemistry → Physics …) to the `/mcat` feature: build the AAMC-grounded keyword taxonomy, run the content pipeline, and light it up in the UI. This is the generalized, reusable method distilled from two completed builds:
- **Biology** (FC 1–3) — [mcat-taxonomy-audit-2026-06.md](mcat-taxonomy-audit-2026-06.md)
- **Psych/Soc** (FC 6–10) — [mcat-psychsoc-taxonomy-2026-06.md](mcat-psychsoc-taxonomy-2026-06.md) ← the cleanest end-to-end template; copy its artifacts.

> **Golden rule:** a "section" is just `mcat_categories.section` + a `section` URL param (**default `'biology'`**, so existing flows never change) + grounding entries. The two live sections share **all** code paths — there are no section-specific code branches beyond a tab list and a default-biology filter.

---

## The data model (unchanged across sections)

```
mcat_categories (id, section, label, description, order_index)
  └── UMBRELLA keyword   (mcat_keywords: tier='umbrella', parent_keyword_id=NULL)
       ├── INTRO keyword (tier='in_depth', order_index = -1 → sorts first; a 2–3 sentence teaching overview)
       └── IN_DEPTH      (tier='in_depth', order_index 0..n; ONE narrow testable skill each)
```
- Every keyword: `label`, `description` (house style), `examples` (jsonb array of 2–3 cues), **`status='approved'`** (the app filters this — any other status is invisible), `embedding` (jsonb), `embedding_vec` (pgvector), `concept_blueprint` (jsonb scope contract), `yield_level` + `yield_rationale`.
- **Namespace keyword ids per section** to guarantee zero collision with other sections' ids: Biology uses bare slugs; Psych/Soc uses `ps_<code>_<slug>`. Pick a fresh prefix for each new section (e.g. `ch_`, `ph_`). Category ids: `mcat_<section>_<code>_<slug>`.
- The taxonomy is **>1000 rows** (1736 after Psych/Soc). **Any query loading all keywords MUST paginate** (`lib/mathPagedQuery.ts` `fetchAllPages`, or a `range()` loop). Scripts MUST use `createServiceClient` (`scripts/lib/serviceClient.ts`), never bare `createClient` (Node-20 WebSocket crash).

---

## The 7 phases

### Phase 0 — Read the source docs (always, on demand)
[mcat-system.md](mcat-system.md) (architecture), [mcat-depth-standard.md](mcat-depth-standard.md) (the "mile wide, inch deep" bar + the numeric-value decision tree), the prior build doc as a template, and **this file**.

### Phase 1 — Get the verbatim AAMC ground truth
Read the actual AAMC "What's on the MCAT Exam?" 2020 PDF (the per-content-category subtopic lists are the SAME lists given to AAMC item-writers — the only acceptable source; do not work from memory). It's large: use `Read` with the `pages` param, ≤20 pages/call. Find the section's framework page (it lists the Foundational Concept + its content categories) to confirm the page range, then transcribe each content-category Topic→Subtopic→sub-subtopic list **verbatim** into `content/mcat-<section>-taxonomy/_OUTLINE.md`, preserving the PSY/SOC/BIO/PHY/GC/OC course tags.

### Phase 2 — Decide the section → category mapping (the one judgment call)
The platform sections are **by discipline**, which may not be 1:1 with AAMC content categories. Decide which AAMC content categories / subtopics become this section's `mcat_categories` rows, and resolve **cross-section coordination** (what an adjacent section already owns — do NOT duplicate). Precedents:
- Psych/Soc **6A** owns the *psychology* of perception only; the *sensory-organ biology* stays in Biology's `sensory_systems_and_transduction` umbrella.
- Psych/Soc **7A** owns *behavioral* neuroscience; the *cellular* action-potential mechanism stays in Biology.
Write the boundary notes into `_OUTLINE.md` so the build subagents and critics enforce them.

### Phase 3 — Author the taxonomy (manager + fan-out + critics)
1. Write `content/mcat-<section>-taxonomy/_SPEC.md` — the shared house style (copy Psych/Soc's and adjust): tier model; MECE + "one narrow testable skill per keyword, split bundles, add liberally"; coverage mandate ("every AAMC subtopic represented"); description style (**in_depth = imperative verb + the one skill + a boundary sentence "This focuses on X, not Y (a separate keyword)."**; intro = 2–3 sentence overview); `examples` = 2–3 short cues; depth = [mcat-depth-standard.md](mcat-depth-standard.md); slug rules; the output JSON shape; a self-check list.
2. **Fan out one expert subagent per category** (`subagent_type: general-purpose`, model `sonnet`) — each reads `_SPEC.md` + its `_OUTLINE.md` section, writes its tree to `content/mcat-<section>-taxonomy/<CODE>.json`, returns only a 3-line summary (keeps the bulk content out of the manager's context).
3. **Validate deterministically** with a script like `scripts/validate-psychsoc.mjs` (parse, slug/label uniqueness within category, every umbrella has exactly one intro + ≥1 in_depth, examples present). Fix any errors.
4. **Run 1–2 adversarial Opus critics** that re-read all the JSON + `_OUTLINE.md`: a **completeness** critic (find AAMC subtopics with zero/weak coverage) and a **MECE/depth** critic (bundled keywords to split, within-category duplicates, depth violations, missing boundary sentences). Apply fixes — **rebuild a weak category wholesale on Opus** rather than patching dozens of spots (Psych/Soc's 7A was rebuilt this way).

### Phase 4 — Insert via a seed script
Copy `scripts/seed-mcat-psychsoc.ts` → `scripts/seed-mcat-<section>.ts`. It: reads the 12 JSON files, builds category rows (`section='<section>'`, ids, labels, order 0..n) + keyword rows (namespaced ids, `tier`, `parent_keyword_id` from the JSON nesting, intro at `order_index=-1`, **`status='approved'`**, `examples` jsonb, yield/blueprint/embedding null), and **upserts on id** (idempotent) — categories first, then umbrellas, then children (self-FK ordering). Dry-run, then run.

### Phase 5 — Run the content pipeline (ORDER MATTERS)
```bash
npx tsx scripts/seed-mcat-<section>.ts            # 0. insert taxonomy
npm run mcat:embed                                # 1. embeds IN_DEPTH ONLY (umbrellas are skipped by design)
npx tsx scripts/recompute-umbrella-embeddings.ts --system mcat   # 2. umbrella embedding = centroid of children; writes embedding + embedding_vec
# 3. backfill the pgvector column for the in_depth children:
#    UPDATE mcat_keywords SET embedding_vec = embedding::text::vector WHERE embedding_vec IS NULL AND embedding IS NOT NULL;
npm run mcat:blueprints                           # 4. concept_blueprint + yield_level/yield_rationale per in_depth keyword
```
All four scripts are fill-missing and section-agnostic — they auto-pick up the new keywords. (If a single keyword deterministically fails blueprint gen — "no valid output after retry" — hand-author its `concept_blueprint`+`yield_level` via SQL.)

### Phase 6 — Wire the UI + generation grounding
- **`lib/mcatContentOutline.ts`** — add one `OutlineEntry` per new category (`code`, `title`, `focus`, `topics[]` from `_OUTLINE.md`) so generation stays in AAMC scope.
- **`lib/mcatTemplateCards.ts`** — add each new category id to `CATEGORY_TO_TAG_PREFIXES`, mapped to the MileDown anki deck areas (`MileDown::<Area>::*`). Areas: Behavioral (psych/soc), Biology/Biochemistry (bio), **Physics**, **General_Chemistry**, **OChem**, **All_MCAT_Equations**.
- **`app/mcat/page.tsx`** — move the section from `SOON_SECTIONS` into `LIVE_SECTIONS` (the tabs filter the grid by `c.section` and pass `?section=` to the auto/cards/practice heroes).
- **Section param plumbing** (default `biology`, already generic — just confirm it covers the new section): `/api/mcat/taxonomy` returns `section`; `/api/mcat/auto-plan` + `/api/mcat/deck-plan` filter categories by `section` (auto-plan infers from the scope id prefix on deep links); `/mcat/auto`, `/mcat/cards`, `/mcat/practice` thread the param.
- **`section` field on generated content** — the 5 insert sites (`flashcards`/`similar`/`quiz`/`next-question` routes + `lib/lessonLab.ts`) derive section from the category id prefix; extend the helper to the new prefix.
- **`lib/humanize.ts`** — add the `mcat_<section>_` prefix to `STRIP_PREFIXES`.

### Phase 7 — Verify
- **Integrity SQL** (must all be 0): orphans, empty umbrellas, umbrellas missing an intro, not-approved, missing embedding / embedding_vec / (in_depth) blueprint / (in_depth) yield, duplicate labels per category. Plus balanced per-category counts.
- **Typecheck:** `cd apps/student && npx tsc --noEmit -p tsconfig.json` → 0 errors.
- **APIs (no login needed):** `curl /api/mcat/taxonomy?session_id=<uuid>` → new categories present with `section`; `curl '/api/mcat/auto-plan?session_id=<uuid>&section=<section>'` → frontier in the new section; no-section call still starts at Biology.
- **End-to-end:** `POST /api/mcat/next-question {session_id, category_id:<new cat>}` → a real, on-scope, correctly-keyed question; confirm the stored row has `section='<section>'`.

---

## Gotchas (these bit; the scripts are now fixed but stay alert)
1. **status:** new keywords inserted as anything but `'approved'` are invisible (taxonomy/practice/tagging filter `status='approved'`).
2. **>1000 rows:** any un-paginated all-keyword `select` silently truncates at 1000. Paginate.
3. **Node 20:** scripts must use `createServiceClient` (the `ws` transport), not bare `createClient`.
4. **embed only does in_depth:** umbrella embeddings come from `recompute-umbrella-embeddings.ts` (centroid). Don't skip it, or umbrellas have no embedding/embedding_vec.
5. **embedding_vec** is a separate column from `embedding` — backfill it (step 3) for the in_depth children; the centroid script writes it only for umbrellas.
6. **OpenAI key:** the valid key is in `apps/student/.env.local` (root is stale); the embed/blueprint scripts already override it. Supabase keys are valid in root `.env.local`.
7. **LOCAL-ONLY:** do not deploy / push to `main` / commit unless explicitly told.

## Artifact inventory (per section)
`content/mcat-<section>-taxonomy/{_SPEC.md, _OUTLINE.md, <CODE>.json}` (source of truth) · `scripts/seed-mcat-<section>.ts` · `scripts/validate-<section>.mjs` · `docs/mcat-<section>-taxonomy-<date>.md` (build record). The `mcat-keywords.txt` seed file is NOT used for new sections — the JSON is the source of truth; re-run the seed script to re-apply.
