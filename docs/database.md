# Database (Supabase/PostgreSQL)

Migrations in `supabase/migrations/`. Run SQL directly against Supabase — no migration files are used for schema changes.

## Key Tables

| Table | Purpose | Key columns |
|---|---|---|
| **`problems`** | Canonical problem store | `latex_content`, `solution_latex`, `choices`, `correct_index`, `difficulty`, `keyword_weights`, `topic_weights`, `action_weights`, `representation_weights`, `prerequisite_weights`, all four `*_description` fields, `status`, `estimated_difficulty`, `embedding` |
| **`rag_examples`** | Problem templates / seeds | Same content fields + `course`, `promoted_problem_id`, `embedding`, `wrong_answer_data` (jsonb array — each entry has `description`, `embedding`, `keyword_weights` after auto-tagging) |
| **`student_sessions`** | Per-session state | `strengths` (legacy topic EMA), `keyword_strengths` (precalc keyword EMA) |
| **`student_problem_attempts`** | Attempt log | `session_id`, `problem_id` (FK→problems), `correct`, `rating`; unique on `(session_id, problem_id)` |
| **`student_accounts`** | Auth | `username`, `password_hash`, `session_id` |
| **`learn_keywords`** | Precalc keyword catalog | `id`, `label`, `tier` (`in_depth`/`umbrella`), `category_id`, `keyword_type` (`topic`/`action`/`umbrella`), `parent_keyword_id`, `status`, `embedding`. Representation keywords (`category_id = 'representations'`) seeded via `insert_representations.sql`. |
| **`learn_categories`** | Keyword groupings | `id`, `name`, `description`, `order_index` |
| **`learn_student_keyword_states`** | Rich keyword learning state | `in_depth_score`, `umbrella_score`, `state`, `consecutive_correct`, `spaced_review_due_at` |
| **`learn_practice_problems`** | Learn-system MCQs | `keyword_id`, `difficulty`, `hint_latex`, `embedding` |
| **`learn_diagnostic_problems`** | Legacy diagnostic problems | `topic_id`, `in_depth_keywords`, `embedding` |

## MCAT tables (`mcat_*`)

Isolated from the precalc/AP tables — see [mcat-system.md](mcat-system.md). Added by migrations `20260610` / `20260611` / `20260612`.

| Table | Purpose | Key columns |
|---|---|---|
| **`mcat_categories`** | 10 Biology categories | `id`, `section`, `label`, `description`, `order_index` |
| **`mcat_keywords`** | Taxonomy (umbrella + in_depth) | `id`, `category_id`, `label`, `description`, `tier` (`umbrella`/`in_depth`), `parent_keyword_id`, `examples`, `status`, `order_index`, `embedding` |
| **`mcat_questions`** | Generated MCQs | `category_id`, `stem`, `choices` (jsonb[4]), `correct_index`, `explanation`, `keyword_weights`, `difficulty` ([0.2,0.9], LLM-set), `parent_question_id`, `embedding`, `avg_rating`, `rating_count`, `flag_count`, `status` (`active`/`flagged`) |
| **`mcat_flashcards`** | Generated flashcards | `category_id`, `front`, `back`, `keyword_weights`, `embedding`, `avg_rating`, `rating_count`, `flag_count`, `status` |
| **`mcat_lessons`** | Cached micro-lessons | `keyword_id` (unique), `micro_steps` (jsonb), `model`, rating/flag counts |
| **`mcat_question_attempts`** | Question attempt log | `session_id`, `question_id`, `selected_index`, `correct`, `response_type` (`answered`/`dont_know`), `context` |
| **`mcat_flashcard_attempts`** | Flashcard attempt log | `session_id`, `flashcard_id`, `result` (`got_it`/`missed_it`/`dont_know`) |
| **`mcat_student_keyword_states`** | Per-keyword mastery (normalized, **not** JSONB) | PK `(session_id, keyword_id)`; `score`, `total_attempts`, `correct_attempts`, `consecutive_correct`, `dont_know_count`, `state`, `spaced_review_due_at`, `spaced_review_count` |
| **`mcat_content_feedback`** | Ratings + flags | `session_id`, `content_type` (`question`/`flashcard`/`lesson`), `content_id`, `rating` (1–5), `flagged`, `flag_reason` |

## Notes

- `problems.problem_id` FK constraint: `student_problem_attempts.problem_id` must exist in `problems`. When a `rag_example` is promoted on first serve, it gets inserted into `problems`; if promotion fails, the attempt upsert throws FK violation (code `23503`) — handled non-fatally in `record-attempt`.
- RLS: anonymous users read approved problems only; service role used in API routes.
- `rag_examples.course`: `"precalc"` or `"ap_calc"` — scopes which pool is used for each practice mode.
