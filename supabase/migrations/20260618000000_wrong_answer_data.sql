-- Per-distractor metadata for wrong-answer-driven weight updates.
--
-- wrong_answer_data is a JSONB array ALIGNED 1:1 to the question's `choices`:
--   - For each WRONG choice: { "description": string, "embedding": number[1536],
--                              "keyword_weights": { "<keyword_id>": number } }
--     where keyword_weights names the in_depth keyword(s) the misconception
--     implicates (the "wrong idea" the distractor encodes).
--   - For the correct choice: null.
--
-- When a student picks a wrong choice, the attempt route shifts their mastery on
-- that distractor's keyword_weights toward the misconception (~20%), instead of a
-- flat generic penalty. Runtime is fail-soft: a null/absent column = old behavior.
--
-- Mirrors rag_examples.wrong_answer_data (legacy precalc system).

ALTER TABLE math_questions ADD COLUMN IF NOT EXISTS wrong_answer_data jsonb;
ALTER TABLE mcat_questions ADD COLUMN IF NOT EXISTS wrong_answer_data jsonb;
