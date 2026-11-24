-- Evidence library: the date each source was read (shown in the references as "Accessed YYYY-MM-DD").
-- Additive only; rows from before this migration have no date.

ALTER TABLE evidence_items ADD COLUMN IF NOT EXISTS accessed_on DATE;
