# Continue-Progress Journey & Routing

Read when working on auth routing, the onboarding→diagnostic→practice flow, or session/stage state.

Intended journey: **onboarding (`/`) → register → diagnostic (`/demo`) → practice (`/demo-practice`)**. A returning user resumes where they left off; logout returns to onboarding.

## Stage signal (server-side)
- `student_accounts.diagnostic_completed_at timestamptz` — set the first time a student finishes the diagnostic, read at login to route returning users.
- Set via `POST /api/demo/complete { accountId }` (fire-and-forget from the `/demo` "done" effect; only writes if currently null).
- Returned as `diagnosticCompletedAt` by `/api/auth/login` and `/api/auth/register` (register is always `null`).
- A localStorage hint `ap_calc_diagnostic_done = "1"` mirrors the flag for instant client routing; the server remains source of truth. Cleared on logout.

**Routing decisions** (all honor the stage):
- `/login` success → `diagnosticCompletedAt` set → `/demo-practice`, else `/demo`.
- `/` (logged in) → hint set → `/demo-practice`, else `/demo`.
- `/demo` mount guard → hint set → redirect to `/demo-practice` (returning users never see "Start diagnostic").

## Durable practice position (server-side)
`student_sessions.practice_keyword_id / practice_phase / practice_lesson_step / practice_problem_id / practice_updated_at` store where the student left off inside `/demo-practice`.
- `POST /api/demo-practice/position { sessionId, keywordId, phase, lessonStepIdx, problemId }` — saved fire-and-forget at each transition (keyword start, queue advance, lesson open + step change, problem load, refresher). Not saved on `phase === "done"`.
- `GET /api/demo-practice/position?sessionId=` — read on mount; if the saved keyword is still in the rebuilt queue and the phase is resumable (`practicing` / `lesson` / `refresher`), the page jumps to it (restoring lesson step). Practice problems resume to the correct keyword with a fresh problem (the practice API serves "next", not by id), which is acceptable — keyword + phase is the priority.

## Logout
The `/demo` and `/demo-practice` logout buttons clear `SESSION_KEY`, `ACCOUNT_KEY`, and the `ap_calc_diagnostic_done` hint, then `router.replace("/")` (onboarding). The `if (!accountId) → /login` **auth guards** are unchanged (correct for unauthenticated users).

## Session continuity
`student_accounts.session_id` is a stable 1:1 id; `/api/auth/login` always returns it, so server-side progress (`learn_student_keyword_states`, `student_sessions`) survives logout/login. See [progress-report.md](progress-report.md) → "Score permanence across logins".

## Migration
These columns are added by `supabase/migrations/add_diagnostic_stage_and_practice_position.sql`. **Apply it in Supabase before the feature is live.** All routes degrade gracefully pre-migration (position GET → `{keywordId:null}`, complete POST → `{ok:false}`, login reads the flag defensively), so the app runs without the migration — it just falls back to `queue[0]` and localStorage-only stage routing.
