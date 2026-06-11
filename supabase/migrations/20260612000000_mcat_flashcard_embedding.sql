-- Add vector embedding column to mcat_flashcards for semantic search and keyword retagging.
ALTER TABLE mcat_flashcards ADD COLUMN IF NOT EXISTS embedding JSONB;
