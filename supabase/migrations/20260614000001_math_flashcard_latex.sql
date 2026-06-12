-- Align math_flashcards column names with the *_latex convention used by math_questions
-- and the mathGenerator lib (front_latex/back_latex). Table is empty; rename is safe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'math_flashcards' AND column_name = 'front') THEN
    ALTER TABLE math_flashcards RENAME COLUMN front TO front_latex;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'math_flashcards' AND column_name = 'back') THEN
    ALTER TABLE math_flashcards RENAME COLUMN back TO back_latex;
  END IF;
END $$;
