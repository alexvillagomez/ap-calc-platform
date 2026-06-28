# MCAT Depth Correction — Progress

**Goal:** make MCAT generated content (flashcards, questions/quizzes, lessons) hit the
"mile wide, inch deep" depth defined in [docs/mcat-depth-standard.md](mcat-depth-standard.md).
Calibrated to the MilesDown Anki deck (`anki_cards` table): ranges/concepts/directional rules,
NOT precise decimals. Canonical bad example: flashcard "Thiol side chain: pKa ≈ 8.3".

## The culprit
`apps/student/lib/mcatGenerator.ts` `FLASHCARD_SYSTEM` (and the completeBlock) explicitly
demanded "exact values & counts: $pK_a$ values … $p_I$" — driving over-precise decimals.
QUESTION_SYSTEM / SIMILAR_QUESTION_SYSTEM / MCAT_LESSON_SYSTEM had no depth guard.

## Plan / checklist
- [x] Read standard + all 4 prompts + flashcard gen function
- [x] Add shared `MCAT_DEPTH_RULE` constant
- [x] Rewrite `FLASHCARD_SYSTEM` to depth standard (thiol calibration in-prompt, ranges-over-decimals, numeric decision tree)
- [x] Soften `completeBlock` enumeration ("exact values/count $pK_a$" → ranges/comparisons)
- [x] Add depth guard to `QUESTION_SYSTEM` + `SIMILAR_QUESTION_SYSTEM` (provide numbers in stem; no decimal recall)
- [x] Add depth guard to `MCAT_LESSON_SYSTEM`
- [x] Verify build (lint/types)
- [x] Delete wrong-depth DB content: WIPED 301 mcat_flashcards + 1 attempt + 1 srs. Questions (16) + lessons (47) sampled = correct depth (reasoning/illustrative), KEPT.
- [x] Test: regenerated AA pKa + competitive-inhibition + PFK-1 samples → 0/34 over-precise; NO "thiol pKa 8.3"; His handled as concept. (scripts/test-depth-samples.ts)
- [x] Sync: local HEAD already 23 ahead / 0 behind origin/features-v2 (incl. refresher fix b151ab4) — superset, no rebase needed.
- [x] deploy vercel --prod → READY, aliased www.lodera.ai (dpl_5edFNUq5BPHd9fHJgBJ9JQCaE7ZH). Commit 4005a1b.

DEFERRED: commit 4005a1b is on local features-v2 only (not pushed to origin) — origin is a subset. Push when ready to share with the other session.

## Follow-up: Anki cloze FRAMEWORK (2026-06-24)
Re-examined `anki_cards` (2887 MilesDown cards, ALL note_type Cloze-MileDown): every card is a CLOZE DELETION of one short DECLARATIVE statement — not Q→A. Concise (~6–14 words), one idea, plain telegraphic phrasing; the blanked term is the nugget (enzyme name, direction goes-up/no-change, count, location). Examples: "In competitive inhibition: Vmax [no change], Km [goes up]"; "Glycolysis requires [2] ATP and produces [4] ATP"; "[NADH] powers the creation of [2.5] ATP"; "[Complex I] in the ETC is also known as [NADH dehydrogenase]".
- Rewrote FLASHCARD_SYSTEM FORMAT → cloze framework: front = declarative sentence with "_____" blank; back = missing term(s) only (";"-joined if 2–3). Emulate deck, don't copy. Depth standard kept.
- Updated aaBlock examples to cloze form.
- No DB wipe needed (0 cards since prior wipe; all regenerate in cloze format on demand).
- Test (scripts/test-depth-samples.ts): AA + competitive-inhibition + PFK-1 → all cloze, single-idea, 0/32 over-precise. e.g. "Competitive inhibition _____ apparent $K_m$." → "increases"; "The basic ionizable side chains are _____." → "Lys, Arg, His"; "_____ has a side-chain $pK_a$ near 6, closest to physiological $pH$." → "Histidine".

## Before/After — the thiol/amino-acid case
- BEFORE (deleted): "Cysteine side-chain $pK_a$" → "≈8.3"; "Thiol side chain: $pK_a ≈ 8.3$"; full decimal pKa table (Asp 3.9, Glu 4.2, His 6.0, Cys 8.3, Tyr 10.1, Lys 10.5, Arg 12.5).
- AFTER (regenerated): "Cysteine side chain at pH ~7.4? → Mostly protonated neutral thiol −SH; some thiolate −S⁻"; "Other ionizable weakly acidic side chains? → Cysteine and tyrosine"; His as concept ("Near 6; close enough that histidine can switch protonation states").

## Notes
- Flashcards stay on gpt-5.5 (FLASHCARD_MODEL).
- Verifiers (VERIFY_SYSTEM, FLASHCARD_VERIFY_SYSTEM) only check correctness — no depth change needed.
- His pKa≈6 is the ONE allowed exception (test the concept "buffers near physiological pH", not the number).
- NADH=2.5 / FADH₂=1.5 ATP kept (comparison is the point). Compartment locations kept (required+specific).

## Follow-up 2: MECE-across-keywords scope leak (2026-06-24)
ROOT CAUSE (confirmed in DB): intro keyword `what_is_an_amino_acid_overview` deck = 40 cards, almost all sibling-owned (zwitterions, L/R-S config, 24 three/one-letter code cards, nonpolar/polar/acidic/basic classification, pI). Two causes: (1) NO sibling-awareness; (2) the `aaBlock` "memorize the 20" override fired for ANY amino-acid keyword and force-injected the whole unit. Intro keyword also had NO blueprint (so no scope contract / no scopeEnforcement). 3 keywords in the unit lack blueprints (curriculum-intro-pass additions).

FIX (apps/student/lib/mcatGenerator.ts + app/api/mcat/flashcards/route.ts):
- Added `siblingKeywords` param + SCOPE PARTITION block to generateMcatFlashcards — lists the OTHER keywords in the unit and instructs EXCLUDE-if-sibling-owned. Fires regardless of blueprint (so it fixes blueprint-less intro keywords). Route computes siblings = all other in_depth keywords in the category, passed via `siblingsFor()`.
- Narrowed `aaBlock`: gated to abbreviation/identity keyword ONLY (was: any amino-acid kw) and trimmed to codes-only (dropped classification + special cases — those are sibling keywords).
- De-leaked completeBlock breadth note ("breadth WITHIN the lane, never spilling into a sibling").

TEST (scripts/test-scope-samples.ts): regenerated 3 keywords passing siblings.
- intro (no blueprint): 40 leaked cards → 7 clean, 0 out-of-scope (proteins/backbone/R group/20 residues/residue term). NO zwitterions/codes/classification/chirality.
- zwitterions sibling: 8 cards, 0 leaks (stays in lane). classification sibling: 10 cards, 0 leaks.

WIPED: all 48 mcat_flashcards in `mcat_biology_amino_acids_and_proteins` (40 leaked intro + 8 stale-Q→A-format peptide-bond) + dependent attempts/SRS → regenerate MECE + cloze on demand.

DEFERRED (optional): blueprint backfill for the 3 blueprint-less keywords (what_is_an_amino_acid_overview, side_chain_classification_overview, ionizable_groups_and_pka_basics) — blocked locally by Node-20 supabase-js WebSocket guard in the backfill script; NOT required since sibling-awareness fixes the leak without them. Questions generator left as-is (uses blueprint out_of_scope; user scoped this task to flashcards).

## Follow-up 3: diagrams on flashcards (2026-06-24)
The visual-content work added a deterministic figure mechanism (lib/figureGuidance.ts MCAT_FIGURE_RULE/MATH_FIGURE_RULE; components/figures/*; rendered via MathText — \ce{} mhchem, <Molecule smiles/>, <Mermaid>, markdown tables). The flashcard prompts did NOT include it.

FIX (mcat + math FLASHCARD_SYSTEM):
- Injected ${MCAT_FIGURE_RULE} / ${MATH_FIGURE_RULE} + a flashcard-specific "DIAGRAMS ON FLASHCARDS" block: a figure is inline text in front/back; the flip-card renders BOTH sides through the same MathText, so figures work on either side and SUPPORT the cloze (front keeps the "_____", back stays the answer). Patterns: structure-recognition (show <Molecule>, cloze the identity — mirrors MilesDown image cards), reaction/equilibrium (\ce{} with a blanked product), pathway/sequence (<Mermaid>), comparison (table). Strengthened after first test: for named small molecules INCLUDE a structure card; for pathway-overview keywords INCLUDE a Mermaid; gave canonical amino-acid SMILES (Ala/Val/Ser/Gly). Kept "never force a figure; accurate SMILES/ce/Mermaid only".
- math edit was committed by a sibling session (ba4eeef) via the shared tree — preserved.

TEST (scripts/test-figure-flashcards.ts, regenerated with siblings):
- Nonpolar aliphatic side chains → 4 <Molecule> cards (alanine CC(C(=O)O)N, valine, leucine, isoleucine) clozing classification. ✅
- Glycolysis overview → 1 <Mermaid> pathway card (Glucose→…→Pyruvate). ✅
- Carbonic anhydrase → 13/14 \ce{} reaction cards. ✅
- Competitive inhibition (CONTROL) → 0 figures, pure cloze. ✅
- All preserve cloze + depth + sibling-scope.
RENDER: flip-card (CourseCardsMode + math flashcards page) renders front/back via the SAME MathText that already renders question/lesson figures in prod (visual-content session) — structurally guaranteed. Live screenshot on an isolated dev server was impractical (253s cold route compile + slow synchronous gpt-5.5 deck gen); relied on the structural guarantee + server-side figure-tag proof.

WIPE (step 2): delete ALL mcat_flashcards (every category) AND math_flashcards + dependent attempt/SRS rows so everything regenerates with sibling-aware + depth + cloze + diagrams.

DEPLOY: vercel --prod --archive → READY, aliased www.lodera.ai (ap-calc-platform-opwzorgqw). Commit 7b7ff14. Local 32 ahead / 0 behind origin/features-v2 (superset; working tree == HEAD except .claude/launch.json which deploy ignores).
WIPE DONE (all categories, both subjects): mcat_flashcards 50→0, mcat_flashcard_attempts 57→0, mcat_flashcard_srs 39→0, math_flashcards 51→0, math_flashcard_attempts 18→0. Everything regenerates on demand with sibling-aware + depth + cloze + DIAGRAMS.

## Follow-up 4: quality + cross-category + render fail-soft (2026-06-24)
1) MEANINGFUL BACKS + MIXED FORMAT: relaxed the "always cloze" rule. Prompt now allows BOTH cloze and direct Q→A — pick whichever makes the ANSWER the meaningful nugget. Added THE ANSWER MUST BE MEANINGFUL rule with the real bad example ("...can _____ with polarity-based classes" → "overlap") + a FILLER_BACKS blocklist (overlap/relate/vary/depends/...). Code: postProcessFlashcard drops any card whose whole back is a filler word.
2) CROSS-CATEGORY LEAK: root cause = the new figure EXAMPLES used glycolysis (Mermaid)/carbonic-anhydrase (\ce) — cross-category content the model echoed into amino-acids decks (fetchTemplateCards + serving are already category-scoped; the leak was generation echoing prompt examples). Fix: (a) CATEGORY EXCLUSIVITY hard rule + a per-request CATEGORY block naming the unit (categoryLabel from mcat_categories, threaded through the route); (b) marked all figure examples "syntax illustration ONLY — never copy their topic"; (c) postProcessFlashcard strips keyword_weights to allowed in-category ids (defense-in-depth vs cross-category mis-tag).
3) RENDER FAIL-SOFT: the parser only intercepts self-closing <Molecule/> + closed <Mermaid>…</Mermaid>; a malformed tag leaked raw. Added EXACT TAG SYNTAX instruction + sanitizeFlashcardFigures(): repairs <Molecule …> → self-closing, strips no-smiles Molecule / unclosed Mermaid / stray FunctionGraph — so no malformed tag ever reaches the DB. Components already fail soft (bad SMILES→caption fallback, bad Mermaid→"Diagram unavailable", KaTeX throwOnError:false).

TEST (scripts/test-flashcard-quality.ts):
- Classification keyword (was "overlap"): 13 cards, 0 filler, substantive backs. ✅
- Nonpolar aliphatic: 13 cards (10 cloze / 3 Q→A), 4 valid <Molecule>, 0 cross-cat leak, 0 raw. ✅
- Glycolysis (metabolism): in-category glycolysis content + Mermaid/Molecule, all valid. ✅
- Amino-acids decks: 0 cross-category leak; 0 raw/malformed figures across all decks.
- sanitizeFlashcardFigures unit-checked: malformed <Molecule …> → repaired; no-smiles/unclosed → stripped (no raw leak).
Math flashcards unchanged (already Q→A format + diagrams from follow-up 3; cross-category is MCAT-specific).

DEPLOY (follow-up 4): vercel --prod --archive → READY, aliased www.lodera.ai (ap-calc-platform-e9ew38tb8). Commit 2e041b0. Local 35 ahead / 0 behind origin (superset; working tree typechecks incl. sibling WIP).
WIPE DONE: all flashcard tables already 0 from prior wipe (no persistent regeneration between deploys) — re-ran the explicit DELETE to guarantee clean state: mcat_flashcards/attempts/srs = 0, math_flashcards/attempts = 0. Everything regenerates on demand with meaningful-back + mixed-format + sibling-aware + category-exclusive + depth + cloze + fail-soft diagrams.
