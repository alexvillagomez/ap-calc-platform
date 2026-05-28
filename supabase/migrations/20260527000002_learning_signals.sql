-- Learning signal columns for learn_student_keyword_states
-- These enable time-weighted EMA scoring and richer progress analytics

ALTER TABLE learn_student_keyword_states
  ADD COLUMN IF NOT EXISTS avg_response_ms    INTEGER   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fast_correct_count INTEGER   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hint_used_count    INTEGER   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_count        INTEGER   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spaced_review_count INTEGER  DEFAULT 0;

COMMENT ON COLUMN learn_student_keyword_states.avg_response_ms    IS 'Rolling average time to answer in ms (exponential moving avg)';
COMMENT ON COLUMN learn_student_keyword_states.fast_correct_count IS 'Number of times answered correctly in < 8 seconds (confident mastery signal)';
COMMENT ON COLUMN learn_student_keyword_states.hint_used_count    IS 'Number of times a hint was used before answering';
COMMENT ON COLUMN learn_student_keyword_states.retry_count        IS 'Number of times answered wrong then retried the same question';
COMMENT ON COLUMN learn_student_keyword_states.spaced_review_count IS 'How many spaced review cycles have been completed';
