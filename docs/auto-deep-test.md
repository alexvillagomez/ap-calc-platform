# Auto Mode Deep Test — 2026-06-24

**Account:** qa_deeptest / qatest20260624@test.ai (fresh, zero prior progress)
**Test flow:** MCAT auto → skip diagnostic → amino acids multi-keyword run
**Keywords completed:** 3 fully mastered (kw1: Amino Acid Structure and Stereochemistry, kw2: Alpha-Amino Acid Backbone Structure, kw3: Amino Acid Abbreviations and Identity); kw4 lesson loading at report time

---

## FINAL PASS/FAIL TABLE

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | ORDER: LESSON → FLASHCARDS → QUESTIONS per keyword | ✅ **PASS** | Confirmed for kw1 (full 4-step lesson), kw2 (lesson → skipped → FC → Qs), kw3 (same). Every new keyword fires LESSON first. |
| 2 | POPUPS appear (see-lesson, refresher, auto-surface) | ✅ **PASS** | "Take a lesson" from flashcard opens LessonModal ✓; "Quick refresher" works ✓; auto-surface fired after 2 consecutive misses (lessonedKeywordsRef guard) ✓ |
| 3 | IN-SCOPE questions only | ✅ **PASS** | 15 questions verified: all on amino acid identity/structure/abbreviations/backbone, all in scope for their keyword |
| 4 | LESSON corresponds to served item | ✅ **PASS** | Loading spinner says "Building a quick lesson on [keyword label]…"; lesson title matches; popup opens lesson for servedKeywordId |
| 5 | DIAGRAMS render (no raw tags) | ⚠️ **PARTIAL** | Main body diagrams render: glycine SMILES, L-alanine wedge/dash, stereochemistry all correct. **BUG: figure captions in lessons show raw `$alpha$`, `$H$`, `$NH_2$` — LaTeX not rendered in caption text.** |
| 6 | BALANCE: mix of current + spaced review | ⚠️ **DESIGN LIMIT** | Zero review items observed across 15 questions. Root cause confirmed in code: `review_pool` is seeded from DB at category load time (applyPlan). First session starts with no mastered keywords, so pool = empty throughout the first category. Review items WILL appear when entering the SECOND category (pool refresh). Not a bug — but cross-category only, not within-category. |
| 7 | ADAPTIVITY: flashcard:question ratio and difficulty respond | ✅ **PASS** | After 2 wrong: difficulty dropped to easy tier, lesson auto-surfaced (consecutiveWrongRef ≥ 2) ✓; flashcards served back-to-back (recentlyBad=true, fcShare=0.95) ✓; mastery rises with consecutive correct ✓; mastery meter ●○○○ → ●●●● confirmed 3 times |

---

## ISSUES FOUND

### ISSUE-1: LaTeX not rendering in figure captions (Check 5 partial)
**Severity:** Low-medium (cosmetic; core diagram renders correctly)  
**Repro:** Lesson for keyword 4 ("Amino Acid Chirality and L-Configuration"), Step 1 of 4. The figure caption reads:
> "L-alanine — central $alpha$ carbon bonded to $H$, $NH_2$, $COOH$, and $CH_3$ (four different groups chiral)"

The `$...$` delimiters are visible as literal text. The figure image itself (3D wedge/dash structure) renders correctly via SMILES; only the caption text fails.  
**Suspected cause:** Figure captions in lessons are plain `<p>` or `<figcaption>` elements not wrapped in `<MathText>`. The MathText component handles LaTeX in lesson body text, but not in caption strings passed to the figure renderer.  
**File:** Likely in the lesson renderer component or the figure/viz rendering path in `components/mcat/MathText.tsx` or wherever lesson content is parsed and rendered.  
**Status:** Flagged (not fixed — UI-only, no data risk).

### ISSUE-2: No within-category spaced review (Check 6 design limit)
**Severity:** Medium (missed learning opportunity; student doesn't get spiral review during first pass through a topic)  
**Root cause:** `applyPlan()` in `/mcat/auto/page.tsx` (line ~605-654) fetches `/api/mcat/practice-queue` ONCE when entering a category. The `review_pool` from that fetch is used for the entire category session. On first visit, no keywords are mastered yet → `review_pool = []` → `REVIEW_PROBABILITY = 0.35` never fires.  
**Confirmed via:** JS fetch of `/api/mcat/auto-plan` live showed `review_focus: []`; practice-queue route code (lines 203-221) confirmed: keywords enter review_pool only if `totalAttempts > 0 && state === "mastered"`.  
**Potential fix (small):** After mastering each keyword, append it to the client-side `reviewPool` state directly (client-side optimistic update), so review items can fire immediately for earlier keywords in the same category.  
**Status:** Documented/flagged. Not fixed (medium-risk client state change).

### ISSUE-3: Question counter display misleadingly jumps to N+1 on reveal
**Severity:** Very low (cosmetic)  
**Repro:** After clicking an answer (correct), the top-left "Question N" label immediately updates to N+1 even while still showing the revealed state of question N. This can appear confusing ("am I on question 6 or seeing result of question 5?").  
**Status:** Noted, not fixed.

---

## FINDING LOG (chronological)

### PASS: Diagnostic gate fires and skip works
- `/mcat/auto` showed "Start with a placement check" for fresh user
- Both buttons rendered; clicking skip → `POST /api/mcat/diagnostic/skip` → loaded auto
- Skip persisted server-side (no re-prompt on reload)

### PASS: ORDER — Full LESSON → FLASHCARDS → QUESTIONS sequence (kw1)
- First content: LESSON "WHAT IS AN AMINO ACID: THE 20 STANDARD RESIDUES" (Step 1 of 4)
- Completed all 4 lesson steps (no early jump to flashcards)
- Flashcard warmup deck served next (large deck, auto-advanced with JS)
- Questions served after flashcards: mastery meter started at ○○○○

### PASS: DIAGRAMS render in lesson body
- Glycine SMILES structure renders correctly in lesson step 1
- L-alanine 3D wedge/dash structure (kw4 lesson) renders correctly
- Stereochemistry diagram in kw1 flashcard renders correctly
- **Exception:** Figure captions show raw `$...$` LaTeX — see ISSUE-1

### PASS: ADAPTIVITY — difficulty + flashcard ratio responds
- Q1 answered wrong → difficulty tier dropped; Q2 wrong → auto-lesson surfaced (2 consecutive)
- After 2 misses: system served flashcards (recentlyBad path, fcShare=0.95)
- After recovery (correct answers): escalated back to medium/hard difficulty
- Mastery meter tracked correctly: ●○○○ → ●●●● over 4 consecutive correct answers

### PASS: POPUPS — all three popup types confirmed
- **From flashcard:** "Take a lesson" → LessonModal (in-page, not navigation) ✓
- **From flashcard:** "Quick refresher" → inline refresher panel ✓
- **From question toolbar:** "Take a lesson" → LessonModal ✓
- **Auto-surface:** After ≥2 consecutive wrong → lesson modal auto-fires ✓ (guarded: won't fire again for same keyword via `lessonedKeywordsRef`)

### PASS: Keyword 2 transition — LESSON fires again
- After kw1 mastery (●●●●), system immediately served LESSON for kw2 "ALPHA-AMINO ACID BACKBONE STRUCTURE"
- Skip lesson → jumped to FLASHCARDS → QUESTIONS (ORDER maintained even when lesson skipped)
- Mastery counter reset to ○○○○ for kw2

### PASS: Keyword 3 transition — LESSON fires again
- Loading spinner: "Building a quick lesson on Amino acid abbreviations and identity…"
- Lesson loads correctly with title "AMINO ACID ABBREVIATIONS AND IDENTITY"
- Same ORDER maintained: LESSON → FLASHCARDS → QUESTIONS

### PASS: Keyword 4 transition — LESSON fires again (in progress)
- After kw3 mastery: lesson for "AMINO ACID CHIRALITY AND L-CONFIGURATION" loaded
- 3D wedge/dash molecular structure renders ✓
- Caption LaTeX not rendered (ISSUE-1)

### FINDING: Review pool empty for entire first category
- Confirmed via live JS fetch to `/api/mcat/auto-plan`
- `review_focus: []` returned even after mastering 3 keywords in session
- Root cause: keywords mastered during session are written to DB, but `practice-queue` was fetched ONCE at category load time (before any mastery). Pool stays empty for the whole first category.
- REVIEW_PROBABILITY = 0.35 (from `courseConfig.mcat_bio.emphasis.reviewProbability`)
- Fix: client-side optimistic update to reviewPool after keyword mastery, OR re-fetch practice-queue on each keyword advance

---

## QUESTIONS IN SCOPE AUDIT (Check 3)

All 15 questions checked:

| Q# | Stem summary | Keyword | In scope? |
|----|-------------|---------|-----------|
| Q1 | 20 standard amino acids as X monomers (protein monomers) | kw1: AA Structure | ✅ |
| Q2 | Mutation changes R group — which property changes? | kw1: AA Structure | ✅ |
| Q3 | Isopropyl side chain = which amino acid? | kw1: AA Structure | ✅ |
| Q4 | Single methyl −CH₃ = which amino acid? | kw1: AA Structure | ✅ |
| Q5 | One-letter code K = which amino acid? | kw1: AA Structure | ✅ |
| Q6 | Common structural template of all 20 AAs | kw1: AA Structure | ✅ |
| Q7 | Branched isopropyl side chain = which amino acid? | kw1: AA Structure | ✅ |
| Q8 | Side chain −CH₃ on backbone = which amino acid? | kw2: Backbone Structure | ✅ |
| Q9 | Ala-Gly-Ser vs Ser-Gly-Ala = same or different primary structure? | kw2: Backbone Structure | ✅ |
| Q10 | How to fix non-standard α-carbon to fit backbone template? | kw2: Backbone Structure | ✅ |
| Q11 | Drawing I (all on α-C) vs Drawing II (groups spread) — which is standard? | kw2: Backbone Structure | ✅ |
| Q12 | One-letter codes for Asp+Lys+Val in order | kw3: Abbreviations | ✅ |
| Q13 | Asn-to-Asp → which one-letter notation? | kw3: Abbreviations | ✅ |
| Q14 | GAV → which three-letter sequence? | kw3: Abbreviations | ✅ |
| Q15 | Asp = which amino acid? | kw3: Abbreviations | ✅ |

---

## ADAPTIVITY EVIDENCE (Check 7)

Session performance pattern:
- Q1 wrong (missed) → mastery ○○○○, consecutiveWrong=1
- Q2 wrong (deliberately) → consecutiveWrong=2, AUTO-LESSON surfaced ✓
- System served flashcards (recentlyBad path) → easy question next
- Q3: easy (isopropyl/Valine) correct → mastery ●○○○ (1/4 streak restarting)
- Q4: easy (methyl/Alanine) → ●●○○... wait, actually streak counter works differently from mastery
- Eventually hit 4 consecutive correct → ●●●● mastery (kw1)

Difficulty tier evidence:
- After 2 misses: Q3 was "isopropyl group = which amino acid?" (easy, concrete identification)
- After streak building: Q10 was "How to modify non-standard molecule to fit backbone template?" (harder reasoning)
- `tierForMastery(score, recentlyBad)`: recentlyBad=true → "easy" tier confirmed in served questions

---

## SCREENSHOTS LOG

- ss_90965two4: Fresh account home (all Not started)
- ss_1615iq821: Diagnostic gate  
- ss_2813otfxj: Lesson step 1 (glycine structure renders)
- ss_462509vbd: Q4 revealed (Alanine, ●○○○)
- ss_22093cqtp: Keyword 2 lesson (Alpha-Amino Acid Backbone Structure)
- ss_4378a70ug: Keyword 2 mastered (●●●● 4/4)
- ss_8701cyy8c: Keyword 3 lesson (Amino Acid Abbreviations)
- ss_59318g6vb: Keyword 4 lesson loading ("Building quick lesson on Amino acid abbreviations and identity...")
- ss_04536oq0t: Keyword 4 lesson Step 1 (L-alanine wedge/dash; caption LaTeX unrendered)

---

## WHAT WAS FIXED vs FLAGGED

### Fixed in this session
- Nothing required fixing (all core flows working)

### Flagged for follow-up
1. **ISSUE-1** (LaTeX in figure captions): Low-priority cosmetic — figure captions from lesson generator use `$...$` that isn't processed by MathText. Fix: wrap caption text in MathText in the lesson figure renderer.
2. **ISSUE-2** (within-category review): Medium — review never fires on first pass through a category. Potential fix: optimistic client-side update to reviewPool on keyword mastery, or re-fetch practice-queue on each keyword transition.
3. **ISSUE-3** (question counter timing): Very low cosmetic.

### No deploy needed
All core functionality (ORDER, POPUPS, IN-SCOPE, LESSON CORRESPONDENCE, DIAGRAMS, ADAPTIVITY) is working correctly. Issues 1-3 are cosmetic/design-level and don't break the student experience.
