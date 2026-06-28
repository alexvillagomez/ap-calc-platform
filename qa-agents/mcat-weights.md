# MCAT Mastery/Weighting QA Report

**Session:** 2026-06-22  
**Account:** qa.mcat.judge2@lodera-test.com (qa_mcat_judge2)  
**Session ID:** 3779c9d9-6121-4fbc-82ca-9d22cf704152  
**Persona:** Strong bio student — correct on biology/cell/genetics/metabolism concepts; WRONG on gen-chem quantitative, half-reactions, Michaelis-Menten math, calculation-heavy biochem  

---

## Auth & Onboarding

- ✅ Auth gate works: direct nav to `/mcat/.../practice` redirects to `/login?next=...`
- ✅ Signup works (custom `app_users` + scrypt, httpOnly `lodera_uid` cookie)
- ⚠️ `mcat_session_id` NOT stored in localStorage — lives in React state only. Can't persist across hard reload without account. Risk: if page refreshes, session context lost client-side. Server re-creates via cookie — but client may get a NEW session_id, splitting history. Need to verify.
- ✅ Onboarding overlay skipped (flag already set from prior session — minor: should be tied to account, not device localStorage, so fresh accounts always see it)
- ⚠️ `streak/touch` returns 401 — streaks are broken for this account (not fatal but gamification is non-functional)

---

## Auto Mode — Entry

- Land at `/mcat/auto`
- Auto mode starts in Amino Acids and Proteins → "What Is an Amino Acid" lesson (Step 1 of 4)
- Shows lesson text with LaTeX inline (α-carbon, NH₂, COOH, R=H). Rendering looked correct.
- Has "Skip lesson" / "Try a question →" / Next navigation buttons.

---

## Lesson Content (Step 1: Amino Acid Structure)

- Content: The 20 standard residues, α-carbon, R-group variation. Glycine as smallest example.
- **Quality:** Correct and appropriately scoped. Good baseline intro.
- Proceeding through lesson pages to reach practice...

---

## Practice Log (Answered Questions — cumulative)

| # | Topic/Keyword | Category | My Answer | Correct? | Notes |
|---|---|---|---|---|---|
| (populating below) |

---

## Mastery State Checks

(Will query DB or progress page after sufficient signal)

---

## Issues Log

| ID | Type | Description |
|---|---|---|
| I-001 | Auth/Session | `mcat_session_id` not in localStorage — React state only. Hard reload mid-session loses client context (server re-creates but session continuity needs audit) |
| I-002 | Gamification | `streak/touch` returns 401 for new accounts. Streak/combo XP non-functional. |
| I-003 | Onboarding | `mcat_onboarding_seen` flag is device-localStorage, not account-scoped. New account on same device skips the intro overlay. |

---

## Summary (to be filled after testing)

