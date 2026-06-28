# MCAT Auto Mode — Continuity & Diagnostic Bug Investigation

**Date:** 2026-06-22  
**Branch:** features-v2  
**Scope:** `/mcat/auto`, `/mcat/diagnostic`, `/api/mcat/diagnostic/start`, `/api/mcat/diagnostic/answer`, `/api/mcat/auto-plan`, `lib/mcatDiagnostic.ts`

---

## Bug 1 — "Placement complete" shown after 0 questions answered

### Reproduction steps
1. Log in with a fresh MCAT account (no prior keyword states, no prior diagnostic session).
2. Navigate to `/mcat/auto` → see "Start with a placement check" screen (`needs_diagnostic: true`).
3. Click "Take placement diagnostic" → `/mcat/diagnostic`.
4. Click "Start diagnostic" button.
5. Observe: ~20 s spinner ("Preparing your diagnostic…"), then immediately the "Placement complete" card appears showing "We'll start you at the beginning and adapt as you go." — **no question was ever rendered**.

### Observed vs expected
- **Observed:** "Placement complete" after 0 questions, as if the diagnostic ran to completion.
- **Expected:** At least one diagnostic question is presented to the user before any "complete" state.

### Root cause in code

**`apps/student/lib/mcatDiagnostic.ts:106–207` — `getQuestionForUmbrella`**

When no stored `mcat_questions` exist for the umbrella's category (`available.length === 0`), it falls through to OpenAI generation (lines 141–207). That network call can take 5–20 s and may fail (stale key, timeout, McatGenError). On failure, returns `null`.

**`apps/student/app/api/mcat/diagnostic/start/route.ts:121–144`**

```ts
for (const next of candidates.slice(0, 3)) {
  const question = await getQuestionForUmbrella(supabase, next, []);
  if (!question) continue;
  // ... return question to client
}
// No umbrella could produce a placement question → end gracefully.
return NextResponse.json({ done: true, diagnostic_session_id: diagnosticId });
```

- Tries the first 3 umbrella candidates **serially** — each failed attempt burns one full generation timeout.
- If all 3 fail, returns `done: true` immediately.
- **Critically: the `mcat_diagnostic_sessions` row is left with `status: 'in_progress'` and `asked: []`.** It is never marked `completed`.

**`apps/student/app/mcat/diagnostic/page.tsx:89–95`**

```ts
const data = (await res.json()) as StartResponse;
if (data.done || !data.question) {
  setPhase("done");
  return;
}
```

The page unconditionally goes to `phase: "done"` whenever `done: true` arrives from `start`, even when `askedCount` is still 0.

**`apps/student/app/mcat/diagnostic/page.tsx:374–379`** — render for `phase === "done"`:

```tsx
{askedCount > 0
  ? `You showed strength on ${knownCount} of ${askedCount} topics. Auto mode will start you...`
  : "We'll start you at the beginning and adapt as you go."}
```

So with `askedCount === 0` the card always reads "We'll start you at the beginning" — which looks like a real placement decision but was actually a silent failure.

### Suggested fix direction
- In `start/route.ts`, when returning `done: true` due to exhausted candidates, write `status: 'completed'` to the `mcat_diagnostic_sessions` row (same update performed by the answer route). This unblocks `auto-plan`'s `hasCompletedDiagnostic` check.
- In `diagnostic/page.tsx`, differentiate "completed with 0 questions" from "normally done": when `askedCount === 0` on the `done` screen, show a message like "We couldn't load a placement question right now — you'll start from the beginning." instead of "Placement complete."

---

## Bug 2 — ~20 s spinner before the false "Placement complete"

### Root cause in code

**Serial generation in `start/route.ts:121`**

```ts
for (const next of candidates.slice(0, 3)) {
  const question = await getQuestionForUmbrella(supabase, next, []);  // awaited serially
  if (!question) continue;
}
```

Each `getQuestionForUmbrella` call on a cold pool triggers OpenAI generation (`generateMcatQuestions` → gpt-4o-mini call). If generation times out (e.g., bad key, network), the function catches the error and returns `null` — but only after the full round-trip. With 3 umbrellas failing serially: 3 × ~5–20 s = up to 60 s (in practice, ~20 s when timeouts are short).

### Suggested fix direction
- **Option A (safest):** In the `start` route, skip generation entirely — only use stored questions. If none exist, return `done: true` immediately (fast-fail). Generation is already possible in `answer/route.ts` for subsequent questions; skipping it in `start` keeps placement quick.
- **Option B:** Parallelize the 3 candidates with `Promise.race` / `Promise.allSettled`; return the first that succeeds and cancel the others.
- **Option C:** Add a per-call timeout wrapper around `getQuestionForUmbrella` in the `start` context (e.g., 4 s) so the whole `start` call completes in under 15 s worst-case.

---

## Bug 3 — Diagnostic re-prompts after user already "completed" (including after skip)

### Reproduction steps — via false done
1. User goes through Bug 1 scenario: sees "Placement complete" after 0 questions.
2. Clicks "Start learning" → `/mcat/auto`.
3. `auto-plan` returns `needs_diagnostic: true` again.
4. User sees "Start with a placement check" — forced to re-take it.

This happens **indefinitely** every time the user visits `/mcat/auto`.

### Root cause
**`apps/student/app/api/mcat/auto-plan/route.ts:229`**

```ts
const hasCompletedDiagnostic = !!diagRes.data;  // checks status='completed'
const needsDiagnostic = !hasAnyStates && !hasCompletedDiagnostic;
```

`diagRes` queries for `status = 'completed'`. Because Bug 1 leaves the session `in_progress` forever, `hasCompletedDiagnostic` is always `false` for these users. And since they answered 0 questions, `hasAnyStates` is also `false`. So `needsDiagnostic` is stuck at `true`.

**`apps/student/app/api/mcat/diagnostic/start/route.ts:74–81`** — session reuse

```ts
const { data: existing } = await supabase
  .from("mcat_diagnostic_sessions")
  .select("id, asked, category_estimates")
  .eq("session_id", session_id)
  .eq("status", "in_progress")
  ...
```

The zombie `in_progress` session (from Bug 1) is found and reused on every subsequent `start` call. Since `existing.asked` is still `[]`, the same 3 first umbrellas are retried every time — cycling through the same failure.

### Suggested fix direction
- Fixed by Bug 1's fix: mark the session `completed` whenever `start` returns `done: true`. Then `auto-plan` sees `hasCompletedDiagnostic = true` and stops gating.

---

## Bug 4 — Skip-diagnostic choice is not persisted across page loads

### Reproduction steps
1. Visit `/mcat/auto` → see "Start with a placement check".
2. Click "Skip and start from the beginning".
3. Begin a lesson; close the tab / navigate away.
4. Return to `/mcat/auto` → "Start with a placement check" screen appears again.

The skip is forgotten on every page load.

### Root cause

**`apps/student/app/mcat/auto/page.tsx:1100–1115`**

```ts
onClick={async () => {
  setPhase("loading");
  try {
    const newPlan = await fetchPlan(sessionId);
    if (!newPlan) { setPhase("course_complete"); return; }
    // CLIENT-SIDE ONLY override — nothing written to the server
    await applyPlan(sessionId, { ...newPlan, needs_diagnostic: false });
  } catch ...
}}
```

`applyPlan` is called with `needs_diagnostic: false` hardcoded into the plan object. No server write occurs — no `mcat_diagnostic_sessions` row created, no flag on `student_sessions`, nothing. On the next `fetchPlan` (which hits the server), `needs_diagnostic: true` comes back and the gate re-appears.

### Suggested fix direction
- When the user clicks "Skip and start from the beginning," call a new API endpoint (or extend `auto-plan`) that inserts a completed `mcat_diagnostic_sessions` row with `status: 'completed'`, `asked: []`, `category_estimates: {}`. This makes `hasCompletedDiagnostic = true` persistently, clearing the gate for all future page loads without requiring the user to ever answer a question.

---

## Bug 5 — `start` route overwrites `asked` on resume instead of appending (minor)

### Root cause

**`apps/student/app/api/mcat/diagnostic/start/route.ts:125–131`**

```ts
const asked: AskEntry[] = [
  { umbrella_id: next.id, category_id: next.category_id, question_id: question.id },
];
await supabase
  .from("mcat_diagnostic_sessions")
  .update({ asked })
  .eq("id", diagnosticId);
```

When the `start` route **resumes** an existing `in_progress` session (one that already has answered entries in `asked`), it builds a fresh 1-element array and overwrites the column. All previously answered entries are lost.

This is currently masked by the fact that Bug 3 keeps the session in the broken `in_progress` / empty-asked state, so in practice `existing.asked` is always `[]`. But if a user leaves mid-diagnostic and returns, the `start` route will throw away their prior answers and re-ask from the beginning for the first unasked umbrella — while overwriting whatever was already there.

### Suggested fix direction
- Change the `start` route's write to spread existing asked entries:
  ```ts
  const newEntry: AskEntry = { umbrella_id: next.id, category_id: next.category_id, question_id: question.id };
  const updatedAsked = [...((existing?.asked as AskEntry[] | undefined) ?? []), newEntry];
  await supabase.from("mcat_diagnostic_sessions").update({ asked: updatedAsked }).eq("id", diagnosticId);
  ```

---

## Continuity observations

### What persists across logout/login
- `mcat_student_keyword_states` is keyed by `session_id` = auth uid → survives logout/login perfectly.
- `mcat_diagnostic_sessions` is keyed by `session_id` → same, persists.
- `intro_seen` per-keyword boolean on `mcat_student_keyword_states` → server-authoritative, survives reload (as documented in auto/page.tsx comment lines 56–66).

### What does NOT persist
- The "skip diagnostic" choice (Bug 4 — client-side only).
- In-session state: `queue`, `queueIndex`, current question, combo, etc. — all React state, lost on page reload. The user re-enters the auto mode from the `auto-plan` frontier, which is re-computed from keyword states. If any states were written mid-session, the frontier is preserved; if the user left before answering anything, they restart from scratch.

### Lesson/subtopic progress
- Lesson completion is persisted via `/api/mcat/auto-intro` → `mcat_student_keyword_states.intro_seen = true`. This survives reload.
- Mastery (keyword state) is written on each answer via `/api/mcat/attempt`. Persists correctly.
- The auto-plan frontier is recalculated from persisted states → correct resume point after login.

---

## Summary table

| # | Bug | Trigger | Observed | Expected | Root cause file:line | Fix direction |
|---|-----|---------|----------|----------|---------------------|---------------|
| 1 | "Placement complete" with 0 questions | Cold question pool → generation fails | "done" screen shown, askedCount=0 | At least 1 question shown | `start/route.ts:121–144`, `diagnostic/page.tsx:92–95` | Mark session completed in `start`; differentiate 0-answer done screen |
| 2 | ~20 s spin before false done | Cold pool + serial generation | 3 × openai timeouts | Fast fail or parallel fetch | `mcatDiagnostic.ts:141–207`, `start/route.ts:121` | Skip generation in `start`, or parallel with timeout |
| 3 | Diagnostic re-prompts after apparent completion | `in_progress` session never completed (Bug 1) | `needs_diagnostic: true` every visit | Gate clears once | `auto-plan/route.ts:229`, `start/route.ts:74–81` | Fixed by Bug 1's fix |
| 4 | Skip-diagnostic choice not persisted | User clicks "Skip" in auto page | Re-prompted on every page load | Skip remembered server-side | `auto/page.tsx:1100–1115` | Write completed diagnostic session on skip |
| 5 | `start` route overwrites `asked` on resume | Mid-diagnostic resume | Prior answers lost | Resumes from last answered point | `start/route.ts:125–131` | Append to existing `asked`, not replace |
