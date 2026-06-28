# QA Manager — progress & final state (2026-06-24)

Deploy: **https://www.lodera.ai** (prod, project `ap-calc-platform`, dpl_Cx1xfBq3JcwMERZq4WCXaxVas51j, READY).
Single archive deploy shipped the WHOLE working tree: in-flight figure/caption fixes
(MathText/parseVizSegments/latexRichMathNormalize/figureGuidance/mcatGenerator) + the
deep-test fixes (next-question routes) + auto-popup changes (auto pages) + my work below.

## Built (me)
- **Learn this** (Part 1): scoped in-order mini-auto (lesson→flashcards→questions + spiral
  review of earlier mastered topics). Implemented by adding `scope`/`scope_id` to
  `api/{math,mcat}/auto-plan` (frontier gate `topicInScope`; keyword scope narrows
  `next_focus` to the one skill; diagnostic gate bypassed when scoped) and threading the
  params through both auto pages' `fetchPlan`. Buttons added on category card + umbrella row
  + keyword row of `math/[course]/[categoryId]` and `mcat/[categoryId]` (violet, non-primary).
- **No-decks fix** (Part 4 critical): `CourseCardsMode.loadKeyword` now retries a cold/empty
  generation (2× w/ 1.8s backoff) instead of silently skipping the keyword; terminal error
  now offers **Try again** (reloads stream) not just Go back. Root cause was stale deploy +
  fragile walk — deck-plan returns 58 decks and the flashcards route already generates on
  demand (verified live).

## Verified LIVE (curl, post-deploy)
- deck-plan amino acids → **58** keyword decks (no empty-plan dead end).
- flashcards keyword deck (post-wipe) → **generates 12 cards** on demand (cloze + Q→A).
- auto-plan scope=category → frontier locked to that category, diagnostic bypassed.
- auto-plan scope=keyword → next_focus = exactly that one skill.
- auto-plan unscoped (new session) → needs_diagnostic true (bypass is scoped-only).
- math precalc scope=category → same behavior.
- Build: `next build` compiled + typed + linted clean on combined tree.
- All generation = `gpt-5.4-mini` (gpt-5.5 only in stale comments).

## Subagent findings (killed early by user — partial)
- A (flashcards): flip-card toggles back to front after "Show answer" then tap — flip-state UX confusing. (FLAG)
- B (lessons): lesson = closeable modal ✓, clean heading ✓, figure renders ✓, corresponds ✓.
  Raw-LaTeX figure caption (`$\alpha$`) → **FIXED** by deployed `cleanMoleculeCaption`.
- C (UI): GrindMeter not visible on MCAT flashcards — by design (`hidden` prop, "no big bar up front").

## Flashcard-only mode (Part 2)
CourseCardsMode starts at frontier 0 (first keyword), walks curriculum order via deck-plan,
glosses mastered, interleaves Leitner due-reviews, shifts to weakness-weighted random when
all introduced. Correct as built; hardened with the cold-gen retry above.

## /ec (\ce mhchem)
Empirically rendered `\ce{...}` reactions through katex+mhchem (dist `.mjs`) — all OK, no
fallback/throw. mhchem is registered in MathText. No code bug reproduced; pipeline leaves
`$\ce{...}$` untouched. (Likely was a stale-deploy caption/figure artifact, now fixed.)
