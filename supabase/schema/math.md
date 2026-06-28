# `math_*` tables (Math family — precalc + calc_ab)

Prefix `math_`. Courses `precalc` and `calc_ab` share these tables; the course is
distinguished by `math_course_categories(course, category_id, role)` (a course is
a *view* over shared categories). This is the canonical role list every new
course mirrors.

| Role | Table | Notes |
|------|-------|-------|
| Taxonomy — categories (units) | `math_categories` | |
| Taxonomy — course membership | `math_course_categories` | `(course, category_id, role, order_index)` — multi-course via views |
| Taxonomy — keywords (umbrella + in_depth) | `math_keywords` | numeric `yield_score` 0–1; `embedding`; `concept_blueprint` |
| Taxonomy — prereq DAG | `math_prereq_edges` | powers adaptive diagnostic propagation |
| Dimension pool — ACTION | `math_action_keywords` | |
| Dimension pool — REPRESENTATION | `math_representation_keywords` | |
| Content — questions | `math_questions` | 8-part; 7 embeddings; `keyword_weights` |
| Content — flashcards | `math_flashcards` | `front_latex`/`back_latex`; `embedding` |
| Content — lessons | `math_lessons` | micro_steps + check questions |
| Content — refreshers | `math_refreshers` | 1–2 line popups |
| Attempts — questions | `math_question_attempts` | drives honest progress counts |
| Attempts — flashcards | `math_flashcard_attempts` | |
| Mastery state | `math_student_keyword_states` | EMA score + state machine |
| Diagnostic | `math_diagnostic_sessions` | |
| Feedback | `math_content_feedback` | |

SRS: math uses simple recirculation (`emphasis.srsModel: "simple"`), no per-card
box table.
