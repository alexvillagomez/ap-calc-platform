# `/v2` — The Single-Page App (the new home of lodera.ai)

> **STATUS: THIS IS THE CURRENT CANONICAL DIRECTION (2026-06-29).** Everything new is built on this. The sprawling multi-route app (~45 routes) is being collapsed into ONE page. When this doc and older docs disagree about "the app," this doc wins for the new surface. Old routes still exist and still work, but they are legacy — they will move under `/student` and the new single page will become the root (`/`). **Not deployed yet — local-only until the user explicitly says ship.**

---

## Why this exists
After a business/strategy pass, the product is being radically simplified. The original purpose — *easy, immediate access to studying* — had been buried under modes, drill-downs, and parallel systems. The new bar, in the user's words:

- **Simple** — open the app and *just start*; no barrier to getting there.
- **Intuitive** — never confused about navigation or what things mean.
- **Sleek & fast** — SEAMLESS; not constantly waiting on loads.
- **High quality** — lessons, questions, flashcards.

Business focus: **MCAT first** (revenue, reachable via pre-meds). The moat is the adaptive engine + speed + reward loop, **not** content depth. Math + other MCAT sections are frozen for now.

## Route & migration plan
- **Today:** the new site lives at **`/v2`** (isolated staging mount, additive, nothing deployed).
- **End state:** new single page → `/`; **everything old → `/student`**. That cut-over is a deliberate later step the user triggers; do NOT do the root-swap / `/student` migration until asked.
- Auth-gated (MCAT). Logged-out visitors get an **in-page login/signup popup** (see Auth), NOT a redirect.

---

## Architecture — two layers, cleanly separated
The whole point: **keep the design pixel-perfect, wire real data behind it.**

1. **Design (view) layer** — `page.tsx` + `components/*`. A faithful recreation of a Claude Design handoff (see Design source). Pure presentation; styles are inline + a few keyframes/classes in `layout.tsx`. **Do not restyle these to wire data** — only feed them props.
2. **Data/logic layer** — the hooks + api client:
   - `useMcatPractice.ts` — session bootstrap, taxonomy, the controlled-randomness serve loop, attempts/mastery, points/grind, review queue, prefetch. Mirrors `app/mcat/practice/page.tsx` (the legacy "Custom Practice" page) but exposes plain data + handlers.
   - `useOnDemand.ts` — per-keyword lesson + refresher (cached), pgvector "related topics" search, prioritize toggle.
   - `api.ts` — typed fetch client for every MCAT route + `auth/me`.

`page.tsx` is the thin orchestrator: it calls the hooks and maps their data onto the design components. `mockData.ts` holds the original static sample content + the shared TYPE shapes (kept as prop interfaces; real data is mapped to them).

## File map (`apps/student/app/v2/`, ~4,100 lines)
| File | Role |
|---|---|
| `page.tsx` | Orchestrator: composes the shell, owns view/mode/panel state, wires hooks → components. |
| `layout.tsx` | `/v2`-scoped layout: loads Computer Modern Serif (CDN) + `ldPop`/`ldGlow`/`ldFlip` keyframes + `.ld-serif`/hover helper classes. **No `<html>`/`<body>`** (root layout owns those). |
| `useMcatPractice.ts` | Core serve/answer engine (see Wiring). |
| `useOnDemand.ts` | Lesson/refresher/related-topics/prioritize. |
| `api.ts` | Typed API client + types (`TaxonomyCategory`, `Question`, `Flashcard`, `Refresher`, `MeResponse`, …). |
| `mockData.ts` | Original sample content + prop TYPES. |
| `components/TopBar.tsx` | Logo (left); My-progress + profile avatar (right). |
| `components/LeftSidebar.tsx` | Study toolbar: multi-select modes, search (placeholder), **3-level topic tree**. |
| `components/RightPanel.tsx` | Lessons/refreshers for current + related topics; prioritize; star rating; report. |
| `components/QuestionView.tsx` | MCQ card (A–D, explanation, "I don't know" helper). |
| `components/FlashcardView.tsx` | Flip card (recall → Got it / Missed it). |
| `components/LessonView.tsx` | Inline stepped lesson + shared lesson sub-parts (`LessonHeader`/`LessonProgress`/`LessonExample`/`LessonSkeleton`). |
| `components/Modals.tsx` | MyProgress / Lesson / Refresher modals + Profile dropdown. |
| `components/LoginModal.tsx` | The auth gate popup. |
| `components/icons.tsx` | Inline Lodera logo + all Lucide-equivalent SVG icons. |

---

## Layout & UI
Three columns under a fixed header, all inside a full-bleed app card (`height: 100vh`, `#f0eee9` canvas).

- **Header (fixed):** never scrolls. Logo left; "My progress" + avatar right.
- **Independent scroll:** left sidebar, center, and right sidebar each scroll on their own (the page itself does not scroll). Implementation: outer `height:100vh; overflow:hidden`; body row `flex:1; minHeight:0; overflow:hidden`; left tree is `flex:1; minHeight:0; overflowY:auto` (STUDY/search/TOPICS stay pinned); center `<main>` is a **block** scroll container wrapping a flex content `<div>`; right `<aside>` is `overflowY:auto`.
- **Collapsible panels:** left + right collapse to thin icon rails.

### Left toolbar (study/nav)
- **Modes — multi-select** Lessons / Flashcards / Questions (choose 1–3; at least one always on). These gate what may be shown and drive the center view. (Note: the design README specced single-select; the user overrode to multi-select.)
- **Search** — styled input, **placeholder/non-functional** for now (intended: pgvector search → jump to topic).
- **Topic tree — THREE expandable levels:** Category → Umbrella → in_depth **keyword**. Each level has its own chevron and is selectable; selecting a category/umbrella selects all leaves under it; individual keywords selectable too. Selection = a `Set<leafId>` that feeds the serve pool. Default = first category's leaves (open-and-start); deselect-all → falls back to all Biology.

### Center
Swaps Question / Flashcard / Lesson by active mode(s). Questions + flashcards come from the serve loop; Lessons view loads an on-demand lesson for the current (or first selected) keyword. All dynamic text renders through `MathText` (LaTeX).

### Right toolbar
Heading varies by view. Cards: **current topic** + **related topics** (from pgvector search on the current keyword label), each with **Lesson** + **Refresher** buttons. Pinned bottom: **prioritize**, 1–5 **star rating** (local-only for now), **report** (local-only for now).

---

## Wiring (the real MCAT "general practice" workflow)
Mirror of `app/mcat/practice/page.tsx`. Authoritative payload reference: this doc + that page. Section is **Biology** only.

- **Bootstrap:** Supabase `getUser()` (auth gate) → `getOrCreateMcatSession()` → `GET /api/mcat/taxonomy?session_id=` → seed per-leaf score + category maps. Serve the first item immediately.
- **Serve loop** (`lib/courseEngine/generalPractice` + `adaptive`): `pickKeyword` (≈60% random / 40% weakness), `pickContentKind` (adaptive flashcard-vs-quiz by mastery, constrained to enabled types), `tierForMastery` difficulty, and a missed-item **review queue** (monotonic served-count clock). Next item is **prefetched during the reveal window** so "Next" is instant.
- **APIs (POST unless noted):** `next-question` `{session_id, category_id, keyword_id, difficulty, exclude_ids?}`; `flashcards` `{session_id, category_id, keyword_id}`; `attempt` `{session_id, question_id, selected_index?|dont_know?, context:"practice", usedRefresher?}`; `flashcard-attempt` `{session_id, flashcard_id, result}`; `similar` `{session_id, question_id}`; `GET lesson/[keywordId]`; `GET refresher/[keywordId]`; `search` `{query}` (pgvector related topics); `priority` POST/DELETE; `GET /api/auth/me`. Responses with `keyword_states` merge into the score map.
- **Points/grind:** `awardQuiz()` (+2) / `awardFlashcard()` (+1) before the attempt; `recordQuizAnswer`/`recordFlashcardSeen` after.
- **My progress** = per-category mastery rolled up from taxonomy scores. **Profile** = `/api/auth/me`.

## Boot speed — cross-session queue + two-steps-ahead buffer (2026-06-30)
The retention blocker is latency: every boot used to block on `getUser` → session → **full taxonomy fetch** → then compute the first item (which may trigger 5–30s generation). Now:

- **Persisted serve queue (cross-device).** The serve loop keeps a depth-`BUFFER_TARGET` (2) look-ahead `bufferRef` of already-built items. Those upcoming items are saved (debounced + on `pagehide`/`visibilitychange` with `keepalive`) to **`student_sessions.v2_queue` (jsonb)** via **`/api/mcat/v2-queue`** (GET `?session_id=` / POST `{session_id, queue}`). Because the session id **is the user's uid**, the queue follows them across devices. Client helpers: `fetchQueue`/`saveQueue` in `api.ts`; the saved shape is `SavedQueueItem[]` (`{item, keywordId}`, structurally === the hook's `ActiveItem`).
- **Staged boot.** `bootstrap` fires `fetchQueue(sid)` **in parallel** with the taxonomy fetch. The queue row is tiny, so it resolves first → `applyItem(queue[0])` shows the first item **before taxonomy/generation**, with the rest seeded into the buffer. Restored items render with zero taxonomy (they carry their `keywordId` + payload). `taxonomyReadyRef` gates *computing new* items; `sanitizeSaved` drops any malformed/old cache entry so a bad blob can't crash boot. `page.tsx` holds the **right toolbar** back (`rightReady`) until categories land, so the visible order is **question → category tree (left) → right toolbar**.
- **Two steps ahead.** `refillBuffer()` tops the buffer back up to 2 after every serve **and** in the answer-reveal window (`prefetchNext` is now just `refillBuffer`), generating eagerly on a miss, deduping against the active item + buffered items (`activeKeyRef`/`itemKey`, plus question ids reserved in `excludeRef`). `serveNext` shifts from the front instantly; flashcard-grade and footer-skip now **consume** the buffer too (previously they nulled the prefetch and refetched). The buffer is cleared only when the **selection pool changes** (`commitSelection`). One behavioral nuance: buffering 2 ahead can delay a just-missed review item by up to 2 slots (the review queue is checked at compute time).

## Auth (in-page popup, not a redirect)
`useMcatPractice` does a Supabase `getUser()` pre-check; if logged out it sets `authRequired` and returns **before** `getOrCreateMcatSession` (which would otherwise redirect to `/login`). `page.tsx` renders `<LoginModal>` — a gated popup (no backdrop-dismiss / no X) with a Log in / Sign up toggle, reusing the real flow (`signInWithPassword` for login; `POST /api/auth/signup` + sign-in for signup). On success it reloads; the cookie session is then set and the page bootstraps authenticated.

## Design source
A **Claude Design handoff** (`claude.ai/design`): a single `.dc.html` prototype (custom `<sc-*>`/`support.js` runtime — ignore the mechanics) + a detailed README spec (design system, screens, state model). It was recreated **pixel-perfect** in React/Tailwind — exact hex/radii/shadows, the warm-gray `#f0eee9` canvas, Computer Modern Serif for question/lesson/flashcard text, inline SVG logo/icons, and the `ldPop`/`ldGlow`/`ldFlip` animations. Lesson body copy + flashcard backs were authored in-spirit (the prototype's dynamic template holes weren't in the bundle); moot since real content replaces them.

---

## Known gotchas & fixes (all encountered + resolved during the build)
- **`sessionIdRef`:** the serve loop must read the session id from a **ref**, not the `sessionId` state — state lags one render on bootstrap, so the first request would go out with an empty `session_id` (→ a `"session_id and category_id … required"` 400). Fixed.
- **Scroll structure:** independent column scroll needs the outer pinned to `100vh` + `overflow:hidden`; an inner `overflow:hidden` on a flex child will *clip instead of scroll* (this broke the left tree). Center scrolls via a **block** `<main>` + flex content wrapper.
- **Modal sticky header:** modals are flex-column with a `flexShrink:0` header (close-X) + a `flex:1; overflowY:auto` body, so the X stays reachable when content is long.
- **`MathText` nesting:** it returns a `<div>`; placing it inside `<h2>`/`<span>`/`<button>` is technically invalid HTML but renders and matches the rest of the codebase (the legacy page does the same). Styles inherit fine.
- **Dev `.next` staleness / browser cache:** changes sometimes don't appear even after a normal refresh. Use a **fresh tab/incognito**, or `rm -rf apps/student/.next && npm run dev`. The server SSR can be verified fresh via `curl localhost:3002/v2`.

## Status: done vs placeholder
- **Done & wired:** session/taxonomy, serve loop, questions/flashcards, attempts/mastery, on-demand lesson/refresher, related topics, prioritize, points/grind, My-progress, profile, login popup, 3-level topic tree, fixed header + independent scroll, sticky-X modals.
- **Placeholder / local-only (TODO):** the **search** field (non-functional), **star rating** + **report** (local state, not persisted). Latency on first-question generation still applies (the retention blocker — see [retention-qa-report.md](retention-qa-report.md)).

## Working on `/v2`
- Edit only under `apps/student/app/v2/` for this surface. Reuse shared libs/components (`MathText`, `lib/points`, `lib/grindMeter`, `lib/courseEngine/*`, `getOrCreateMcatSession`) — don't fork them.
- Keep the design pixel-perfect; wire data via the hooks, render dynamic text through `MathText`.
- Verify: `cd apps/student && npx eslint app/v2 && npx tsc --noEmit`. Don't commit/push/deploy or run a prod build against the shared `.next` while `next dev` is running.
- Local dev: `npm run dev` → http://localhost:3002/v2.
