-- Papers found online while answering a question are a research cache, not part of the user's Knowledge Library.
-- They are stored only so an answer can be verified against exact passages and cited with a link.
-- in_library = false: hidden from the library and from signal scans, expires when unused (see purge_stale_cache).
-- A user can promote a paper with "Save to library" (sets in_library = true).
ALTER TABLE sources ADD COLUMN IF NOT EXISTS in_library BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS sources_project_library_idx ON sources (project_id, in_library);
