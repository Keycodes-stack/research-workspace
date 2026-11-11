-- Phase 5: record how each claim was verified (or why it was purged).
ALTER TABLE citations
    ADD COLUMN model       TEXT,             -- model_a | model_b
    ADD COLUMN match_kind  TEXT,             -- exact | normalized | fuzzy
    ADD COLUMN match_score REAL,
    ADD COLUMN reason      TEXT;             -- 'ok' or the purge reason
