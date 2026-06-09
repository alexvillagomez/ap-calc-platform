# Student Progress Report

Read when working on `/progress` or `learn_student_keyword_states`.

The `/progress` page is the student-facing keyword-mastery report (replacing the old live "skill tracker" sidebar; `/demo` now just links out to it). It renders a **3-level tree: Category → Umbrella keyword → Individual (in-depth) skill**, built from three files:

- **`apps/student/app/progress/page.tsx`** — report UI. Top level groups by `learn_categories` (e.g. "Polynomials"); a category reveals its **umbrella keywords** (`tier = 'umbrella'`); an umbrella reveals **individual skills** (`tier = 'in_depth'`) nested via `parent_keyword_id`. Each level has its own expand/collapse state (`expanded` for categories, `expandedUmbrellas` for umbrellas).
- **`apps/student/app/api/learn/progress/route.ts`** — fetches `learn_student_keyword_states` (`in_depth_score`, `state`, `total_attempts`) joined against `learn_keywords` (both tiers + `parent_keyword_id`) and `learn_categories`, then builds the tree. Scores aggregate bottom-up: an **umbrella's score** = average of its tested in-depth skills; a **category's score** = average of its tested umbrellas. A keyword with `total_attempts === 0` reports `null` ("Not tested yet").
- **`TOPIC_TO_CATEGORY` / `CATEGORY_TO_TOPIC`** (inline in `progress/page.tsx`) — map `learn_categories` ids to legacy precalc topic ids for the "Continue studying" deep link into `/learn?topic=...`.

**Low-sample indicator:** any score backed by fewer than `LOW_SAMPLE_THRESHOLD` (5) total attempts is flagged `low_sample: true` (in `progress/route.ts`, both umbrella and skill level) and rendered as an amber "low sample (n=…)" badge (`LowSampleBadge`) next to its `ScoreBar`. `ScoreBar` is the shared renderer for all three levels — colored % bar when a score exists, "Not tested yet" when `null`.

## `learn_student_keyword_states` columns
Key columns: `session_id`, `keyword_id`, `topic_id`, `state`, `umbrella_score`, `in_depth_score`, `confidence`, `consecutive_correct`, `total_attempts`, `correct_attempts`, `spaced_review_due_at`, `last_practiced_at`, `lesson_current_step`, `lesson_completed`. **There is no `consecutive_wrong` column** — wrong streaks are application-state only. (Practice-position columns `practice_*` are added by the continue-progress migration — see [journey-routing.md](journey-routing.md).)

## Score permanence across logins
Scores live in `learn_student_keyword_states`, keyed by `session_id`. `student_accounts` holds a stable 1:1 `session_id` (`/api/auth/login` always returns the canonical id; the client overwrites `localStorage["ap_calc_student_session_id"]` with it), so logout/login preserves scores — no fragmentation in normal use.

The one gap: a **guest** who practices before creating an account. `/api/auth/register` **adopts** the pre-existing guest `session_id` (sent as `existingSessionId`, read from `localStorage` in `login/page.tsx`) instead of minting a fresh empty session — as long as that guest session isn't already claimed by another account (checked via `student_accounts.session_id`, preventing session hijacking through manual `localStorage` edits). This makes the student's prior `learn_student_keyword_states` / `student_problem_attempts` immediately visible under the new account with zero migration.
