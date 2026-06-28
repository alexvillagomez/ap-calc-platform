# `mcat_*` tables (MCAT family — Biology)

Prefix `mcat_`. Single course (`mcat_bio`). Same role-for-role shape as `math_*`
(see [`math.md`](math.md)), with the documented intrinsic differences.

| Role | Table | Notes |
|------|-------|-------|
| Taxonomy — categories | `mcat_categories` | |
| Taxonomy — keywords | `mcat_keywords` | categorical `yield_level` high/med/low; `embedding`; `concept_blueprint` |
| Dimension pool — ACTION | `mcat_action_keywords` | |
| Dimension pool — REPRESENTATION | `mcat_representation_keywords` | |
| Content — questions | `mcat_questions` | `stem`/`explanation`; 7 embeddings; `keyword_weights` |
| Content — flashcards | `mcat_flashcards` | `front`/`back`; `embedding`; MCAT-depth recall |
| Content — lessons | `mcat_lessons` | micro_steps + check questions |
| Content — refreshers | `mcat_refreshers` | |
| Attempts — questions | `mcat_question_attempts` | |
| Attempts — flashcards | `mcat_flashcard_attempts` | |
| Flashcard SRS | `mcat_flashcard_srs` | per-card Leitner box (`emphasis.srsModel: "leitner"`) |
| Mastery state | `mcat_student_keyword_states` | |
| Diagnostic | `mcat_diagnostic_sessions` | umbrella sweep (no prereq edges) |
| Feedback | `mcat_content_feedback` | |

Intrinsic differences vs `math_*` (all are data/config, not bespoke flow code):
- No `mcat_course_categories` (single course) and no `mcat_prereq_edges` (sweep
  diagnostic, not adaptive-with-propagation).
- `yield_level` categorical vs math's numeric `yield_score`.
- Adds `mcat_flashcard_srs` (Leitner); math has no per-card SRS table.
