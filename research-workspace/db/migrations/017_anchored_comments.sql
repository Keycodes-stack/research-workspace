-- Anchored comments (as in Google Docs): a comment is tied to the selected text in the document (a comment mark
-- with its id). anchor_text keeps a copy of that text, so the discussion still makes sense if the text is later
-- deleted. Replies point to their thread through parent_id. A resolved comment records who resolved it and when.
ALTER TABLE work_package_comments
    ADD COLUMN IF NOT EXISTS anchor_text TEXT CHECK (anchor_text IS NULL OR length(anchor_text) <= 1000),
    ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES work_package_comments(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS resolved_by UUID,
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS work_package_comments_parent_idx ON work_package_comments(parent_id);
