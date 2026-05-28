ALTER TABLE rag_examples
  ADD COLUMN difficulty NUMERIC CHECK (difficulty >= 1 AND difficulty <= 5);
